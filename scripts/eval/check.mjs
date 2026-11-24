import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const contract = JSON.parse(await readFile('.sanity-eval/contract.json', 'utf8'));
process.loadEnvFile('.env.local');
const integrity = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'scripts/eval'], { stdio: 'inherit' });
assert.equal(integrity.status, 0, 'The fixture and verifier scripts must match the checked-out revision');
console.log('SANITY_EVAL_INTEGRITY PASS');
const result = spawnSync(process.execPath, ['scripts/eval/verify.mjs', contract.task], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
