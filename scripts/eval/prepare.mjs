import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { apiVersion, client, fixtureContentQuery, fixtureFilter, fixtureId, legacyQuery, outsideFixtureQuery, reference, scenarios, settings, targets, titleTestId } from './fixtures.mjs';

const markerName = 'fieldwork-task.json';
async function taskFromInput(root) {
  const folders = await readdir(root, { withFileTypes: true });
  const markers = (await Promise.all(folders.filter(entry => entry.isDirectory()).map(async entry => {
    const filename = path.join(root, entry.name, markerName);
    try {
      return [JSON.parse(await readFile(filename, 'utf8'))];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }))).flat();
  assert.equal(markers.length, 1, 'Attach exactly one Fieldwork task marker');
  assert.ok(Object.hasOwn(scenarios, markers[0].task), 'Unknown Fieldwork task');
  return markers[0].task;
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const inputRoot = args.find(arg => arg !== '--check') ?? '/tmp/agent-runner-inputs';
const id = await taskFromInput(inputRoot);
const seoDataset = process.env.SANITY_EVAL_SEO_DATASET;
if (seoDataset) assert.equal(id, 'seo-draft-backfill', 'SANITY_EVAL_SEO_DATASET is only for SEO runs.');
assert.ok(seoDataset || process.env.SANITY_EVAL_DATASETS, 'Set SANITY_EVAL_DATASETS to the isolated dataset pool before launching.');
const pool = seoDataset
  ? { [id]: [{ dataset: seoDataset, namespace: `seo-${randomUUID()}` }] }
  : JSON.parse(process.env.SANITY_EVAL_DATASETS);
const perTask = seoDataset ? 1 : Number(process.env.SANITY_EVAL_RUNS_PER_TASK ?? 4);
const project = process.env.SANITY_PROJECT_ID;
const token = process.env.SANITY_API_TOKEN;
assert.ok(Number.isInteger(perTask) && perTask > 0, 'Invalid runs per task');
assert.ok(Array.isArray(pool[id]) && pool[id].length >= perTask, `Configure ${perTask} isolated datasets for ${id} before launching`);
assert.ok(token, 'Set SANITY_API_TOKEN to a credential scoped to the isolated test datasets.');

const recovery = id === 'studio-recovery';
const knownDatasets = new Map();
for (const [task, slots] of Object.entries(pool)) {
  assert.ok(Object.hasOwn(scenarios, task) && Array.isArray(slots), 'Invalid dataset assignment');
  for (const { dataset, reference, namespace } of slots) {
    settings({ SANITY_EVAL_PROJECT: project, SANITY_EVAL_TOKEN: token, SANITY_EVAL_DATASET: dataset, SANITY_EVAL_REFERENCE_DATASET: reference });
    assert.equal(Boolean(reference), task === 'studio-recovery', 'Studio recovery requires a separate reference dataset');
    if (namespace !== undefined) {
      assert.equal(task, 'seo-draft-backfill', 'Shared datasets are only supported for SEO backfills');
      assert.ok(namespace.length <= 44);
      fixtureFilter(namespace);
    }
    for (const name of [dataset, reference].filter(Boolean)) {
      const assignedNamespaces = knownDatasets.get(name) ?? [];
      assert.ok(name.length <= 64, 'Dataset name is too long');
      assert.ok(assignedNamespaces.every(previous => previous && namespace && previous !== namespace), 'Dataset or namespace is already assigned');
      knownDatasets.set(name, [...assignedNamespaces, namespace]);
    }
  }
}

if (checkOnly) {
  console.log(`Sanity dataset settings are present for ${id}.`);
  process.exit(0);
}

const lease = randomUUID();
async function reserve(config, role) {
  const api = client(config);
  // New datasets already contain records in Sanity’s reserved system namespace.
  const occupied = config.namespace ? `*[${fixtureFilter(config.namespace)}][0...1]` : '*[!(_id in path("_.**"))][0...1]';
  if ((await api.query(occupied)).length) return false;
  try {
    await api.mutate([{ create: { _id: fixtureId(config.namespace, 'tracks-eval-lease'), _type: 'tracksEvalLease', lease, role } }]);
    return true;
  } catch (error) {
    if (error.status === 409) return false;
    throw error;
  }
}

async function allocate() {
  for (const { dataset, reference: other, namespace } of pool[id]) {
    const config = { project, token, dataset, other, namespace };
    if (!await reserve(config, 'target')) continue;
    if (other && !await reserve({ ...config, dataset: other }, 'reference')) continue;
    return config;
  }
  throw Error(`No empty dataset assignments remain for ${id}`);
}

const config = await allocate();
const api = client(config);
const other = config.other ? client(config, config.other) : undefined;
await api.mutate(scenarios[id].map(doc => ({ create: { ...doc, _id: fixtureId(config.namespace, doc._id) } })));
if (other) await other.mutate(reference.map(create => ({ create })));

const featured = fixtureId(config.namespace, { 'catalog-migration': 'jacket-en', 'live-draft-preview': 'preview-product', 'seo-draft-backfill': 'target-one', 'studio-recovery': 'recovery-product' }[id]);
const options = {
  'catalog-migration': {
    commands: ['node migrate.mjs', 'node rollback.mjs'],
    storefrontQuery: legacyQuery,
    migrationContract: 'Retain inline specs for the legacy storefront. Add specRef references to sharedSpec documents with material and weightGrams. Equal specs should point to the same document. Leave drafts untouched.',
  },
  'live-draft-preview': {
    start: 'npm run build && npm run start',
    previewEndpoint: '/api/preview?secret=<SANITY_EVAL_PREVIEW_SECRET>',
    productTitleTestId: titleTestId,
    document: 'preview-product',
    privacy: 'Only an authorized editor can view a draft. Keep the read token server-side.',
  },
  'seo-draft-backfill': {
    input: '.sanity-eval/targets.json',
    command: 'node backfill.mjs --targets .sanity-eval/targets.json',
    checkpoint: 'With --checkpoint-stdio, print READY_AFTER_READ after reading eligibility and wait for CONTINUE on stdin. After each successful draft write, print WROTE_DRAFT and wait for CONTINUE or STOP. On STOP exit 75.',
    descriptionLengthLimit: 155,
  },
  'studio-recovery': {
    ports: { storefront: 3000, studio: 3333 },
    document: 'recovery-product',
    workspace: './studio',
    sanityCli: 'Use SANITY_AUTH_TOKEN for the Sanity CLI in Studio. Never print it.',
  },
};
const put = (filename, value) => writeFile(filename, value, { mode: 0o600, flag: 'wx' });
const json = (filename, value) => put(filename, JSON.stringify(value, null, 2) + '\n');
await mkdir('.sanity-eval', { mode: 0o700 });
const configured = [
  `SANITY_EVAL_PROJECT=${project}`, `SANITY_EVAL_DATASET=${config.dataset}`,
  `SANITY_EVAL_REFERENCE_DATASET=${config.other ?? ''}`,
  `SANITY_EVAL_NAMESPACE=${config.namespace ?? ''}`,
  `SANITY_PROJECT_ID=${project}`, `SANITY_DATASET=${config.dataset}`,
  `SANITY_FEATURED_PRODUCT=${featured}`,
  `SANITY_STUDIO_PROJECT_ID=${project}`, `SANITY_STUDIO_DATASET=${config.dataset}`,
  `SANITY_EVAL_PREVIEW_SECRET=${randomBytes(24).toString('hex')}`,
];
if (recovery) {
  configured.push(`SANITY_STOREFRONT_DATASET=${config.other}`);
  const file = 'studio/sanity.config.ts';
  const studio = await readFile(file, 'utf8');
  assert.ok(studio.includes('types: [product]'));
  await writeFile(file, studio.replace('types: [product]', 'types: []'));
}
await put('.env.local', configured.join('\n') + '\n');
await put('studio/.env.local', configured.filter(row => row.startsWith('SANITY_STUDIO_')).join('\n') + '\n');
await json('.sanity-eval/contract.json', {
  task: id, project, dataset: config.dataset, apiVersion, ...options[id],
  verification: 'npm run eval:verify',
  scope: config.namespace
    ? 'The dataset is shared. Only read or change the assigned product IDs in the targets file and their drafts. Preserve all other documents.'
    : 'Use only the assigned target dataset. The reference dataset, when present, is read-only after setup.',
});
if (id === 'seo-draft-backfill') await json('.sanity-eval/targets.json', targets.map(target => fixtureId(config.namespace, target)));
await json('.sanity-eval/before.json', {
  target: await api.query(fixtureContentQuery(config.namespace)),
  ...(config.namespace ? { outside: await api.query(outsideFixtureQuery(config.namespace)) } : {}),
  ...(id === 'catalog-migration' ? { legacy: await api.query(legacyQuery, 'published') } : {}),
  ...(other ? { reference: await other.query('* | order(_id asc)') } : {}),
});
console.log('Fieldwork Shop and task fixtures are ready.');
