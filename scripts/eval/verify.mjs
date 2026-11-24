import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { client, concurrentCopy, content, contentQuery, legacyQuery, migratedQuery, settings, targets, titles, titleTestId } from './fixtures.mjs';

const id = process.argv[2];
process.loadEnvFile('.env.local');
const config = settings();
const api = client(config);
const before = JSON.parse(await readFile('.sanity-eval/before.json', 'utf8'));
const docs = () => api.query(contentQuery);
const byId = (rows) => Object.fromEntries(rows.map(row => [row._id, row]));
const without = (row, ...keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const run = (file, args = []) => {
  const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit', timeout: 90000 });
  assert.equal(result.status, 0, `${file} must exit successfully`);
};

let failures = 0;
async function check(name, verify) {
  try {
    await verify();
    console.log(`SANITY_EVAL ${name} PASS`);
  } catch {
    failures++;
    console.log(`SANITY_EVAL ${name} FAIL`);
  }
}

async function migrate() {
  run('migrate.mjs');
  const first = await docs();
  const products = first.filter(row => row._type === 'product');
  await check('catalog-compatibility', async () => {
    const old = await api.query(legacyQuery, 'published');
    assert.deepEqual(old, before.legacy);
    assert.deepEqual(await api.query(migratedQuery, 'published'), old);
    const converted = byId(products);
    assert.equal(converted['jacket-en'].specRef._ref, converted['jacket-fr'].specRef._ref);
    assert.notEqual(converted['jacket-en'].specRef._ref, converted['hat-en'].specRef._ref);
  });
  await check('catalog-drafts', () => {
    assert.deepEqual(content(products).map(row => without(row, 'specRef')), content(before.target));
    assert.deepEqual(products.filter(doc => doc._id.startsWith('drafts.')), before.target.filter(doc => doc._id.startsWith('drafts.')));
  });
  await check('catalog-idempotent', async () => {
    run('migrate.mjs');
    assert.deepEqual(await docs(), first);
  });
  await check('catalog-rollback', async () => {
    const note = 'Edited after the migration';
    await api.mutate([{ patch: { id: 'drafts.jacket-fr', set: { editorNote: note } } }]);
    run('rollback.mjs');
    assert.deepEqual(await api.query(legacyQuery, 'published'), before.legacy);
    const expected = content(before.target).map(doc => doc._id === 'drafts.jacket-fr' ? { ...doc, editorNote: note } : doc);
    assert.deepEqual(content(await docs()), expected);
  });
}

async function interruptedBackfill() {
  const child = spawn(process.execPath, ['backfill.mjs', '--targets', '.sanity-eval/targets.json', '--checkpoint-stdio'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.stdout.setEncoding('utf8');
  const { createInterface } = await import('node:readline');
  let sawRead = false;
  try {
    const status = once(child, 'exit', { signal: AbortSignal.timeout(90000) });
    status.catch(() => {});
    const timer = setTimeout(() => child.kill(), 90000);
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        if (line === 'READY_AFTER_READ' && !sawRead) {
          sawRead = true;
          const base = byId(content(before.target))['target-three'];
          await api.mutate([
            { createIfNotExists: { ...base, _id: 'drafts.target-three' } },
            { patch: { id: 'drafts.target-three', set: { 'seo': { metaDescription: concurrentCopy }, editorNote: 'Concurrent editor note' } } },
          ]);
          child.stdin.write('CONTINUE\n');
        } else if (line === 'WROTE_DRAFT' && sawRead) {
          child.stdin.write('STOP\n');
          child.stdin.end();
        }
      }
      const [code] = await status;
      assert.equal(code, 75);
      assert.ok(sawRead);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    child.kill();
  }
}

async function backfill() {
  await interruptedBackfill();
  const changed = byId(await docs());
  const eligible = ['target-one', 'target-two', 'target-four'];
  const description = (rows, key) => rows[`drafts.${key}`]?.seo?.metaDescription;
  const partial = eligible.filter(key => description(changed, key));
  run('backfill.mjs', ['--targets', '.sanity-eval/targets.json']);
  const complete = await docs();
  const after = byId(complete);
  await check('seo-eligible-only', () => {
    const original = byId(content(before.target));
    const expected = { ...original };
    for (const key of eligible) {
      const value = description(after, key);
      assert.ok(typeof value === 'string' && value.trim() && [...value].length <= 155);
      const draftId = `drafts.${key}`;
      const base = original[draftId] ?? original[key];
      expected[draftId] = { ...base, _id: draftId, seo: { ...base.seo, metaDescription: value } };
    }
    expected['drafts.target-three'] = { ...original['target-three'], _id: 'drafts.target-three', editorNote: 'Concurrent editor note', seo: { metaDescription: concurrentCopy } };
    assert.deepEqual(byId(content(complete)), expected);
  });
  await check('seo-published-unchanged', () => {
    const published = rows => rows.filter(row => !row._id.startsWith('drafts.'));
    assert.deepEqual(published(complete), published(before.target));
  });
  await check('seo-concurrent-edit', () => {
    assert.equal(description(after, 'target-three'), concurrentCopy);
    assert.equal(after['drafts.target-three'].editorNote, 'Concurrent editor note');
  });
  await check('seo-retry', async () => {
    assert.equal(partial.length, 1);
    run('backfill.mjs', ['--targets', '.sanity-eval/targets.json']);
    assert.deepEqual(await docs(), complete);
  });
}

async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  }))).flat();
}

async function preview() {
  const { chromium } = await import('playwright');
  const root = 'http://localhost:3000';
  process.loadEnvFile('.env.local');
  const secret = process.env.SANITY_EVAL_PREVIEW_SECRET;
  assert.ok(secret);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const browserEvidence = [];
  const open = async context => {
    const page = await context.newPage();
    page.on('request', request => browserEvidence.push(Promise.all([request.url(), request.allHeaders(), request.postData()])));
    page.on('response', response => {
      if (/text|json|javascript/i.test(response.headers()['content-type'] ?? '')) {
        browserEvidence.push(response.text().catch(() => ''));
      }
    });
    return page;
  };
  try {
    const visitor = await open(await browser.newContext());
    const editor = await open(await browser.newContext());
    const getTitle = async (page, title) => {
      await page.getByTestId(titleTestId).filter({ hasText: title }).waitFor({ timeout: 12000, state: 'visible' });
      assert.equal(await page.getByTestId(titleTestId).textContent(), title);
    };
    let navigations = 0;
    await check('viewer-boundary', async () => {
      await visitor.goto(root + '/api/preview');
      assert.ok(!(await visitor.content()).includes(titles.draft));
      await visitor.goto(root);
      await editor.goto(root + '/api/preview?secret=' + encodeURIComponent(secret));
      await getTitle(visitor, titles.published);
      await getTitle(editor, titles.draft);
      editor.on('framenavigated', frame => { if (frame === editor.mainFrame()) navigations++; });
    });
    await check('live-draft-update', async () => {
      await api.mutate([{ patch: { id: 'drafts.preview-product', set: { title: titles.updated } } }]);
      await getTitle(editor, titles.updated);
      await getTitle(visitor, titles.published);
      assert.equal(navigations, 0);
      await visitor.reload();
      await getTitle(visitor, titles.published);
      assert.ok(!(await visitor.content()).includes(titles.updated));
    });
    await check('published-update', async () => {
      await api.mutate([{ patch: { id: 'preview-product', set: { title: titles.updated } } }, { delete: { id: 'drafts.preview-product' } }]);
      await visitor.reload();
      await getTitle(visitor, titles.updated);
    });
    await check('browser-token', async () => {
      const traces = JSON.stringify(await Promise.all(browserEvidence));
      assert.ok(!traces.includes(config.token));
      for (const file of await files('.next/static')) {
        assert.ok(!(await readFile(file)).includes(config.token));
      }
    });
  } finally {
    await browser.close();
  }
}

async function recover() {
  await check('studio-schema', async () => {
    const result = spawnSync('npm', ['exec', '--', 'sanity', 'schemas', 'extract', '--path', '/tmp/sanity-eval-extracted.json', '--enforce-required-fields'], {
      cwd: 'studio', stdio: 'inherit', timeout: 90000,
    });
    assert.equal(result.status, 0);
    const schema = JSON.parse(await readFile('/tmp/sanity-eval-extracted.json', 'utf8'));
    const product = schema.find(type => type.name === 'product');
    assert.ok(product?.attributes?.title || product?.fields?.some?.(field => field.name === 'title'));
    const deployed = await api.query('*[_type == "system.schema" || _id in path("_.schemas.**")]');
    assert.ok(deployed.some(doc => {
      const definitions = typeof doc.schema === 'string' ? JSON.parse(doc.schema) : doc.schema;
      return definitions?.some?.(type => type.name === 'product' && type.fields?.some?.(field => field.name === 'title' && field.type === 'string'));
    }));
  });
  await check('studio-target-content', async () => {
    const [app, studio] = await Promise.all([
      fetch('http://localhost:3000/', { signal: AbortSignal.timeout(10000) }),
      fetch('http://localhost:3333/', { signal: AbortSignal.timeout(10000) }),
    ]);
    assert.ok(app.ok && studio.ok);
    const html = await app.text();
    assert.ok(html.includes(titles.target) && !html.includes(titles.reference));
    assert.match(await studio.text(), /sanity|__sanity/i);
  });
  await check('studio-preservation', async () => {
    assert.deepEqual(await docs(), before.target);
    assert.deepEqual(await client(config, config.other).query('* | order(_id asc)'), before.reference);
  });
}

const verify = { 'catalog-migration': migrate, 'seo-draft-backfill': backfill, 'live-draft-preview': preview, 'studio-recovery': recover }[id];
try {
  assert.ok(verify);
  await verify();
} catch {
  console.log('SANITY_EVAL verifier-incomplete FAIL');
  failures++;
}
process.exitCode = failures ? 1 : 0;
