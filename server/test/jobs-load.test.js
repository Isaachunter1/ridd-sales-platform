// Every job module must import cleanly — a job whose .sql isn't where it looks (Nov 23: peak-values and
// ltv-cohorts read '<name>.sql' beside jobs/ while the file lives in functions/) crashes the whole server at
// boot, so Cloud Run never starts the new revision. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'services');
const jobs = fs.readdirSync(root).flatMap(s => {
  const d = path.join(root, s, 'jobs');
  return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.js')).map(f => path.join(d, f)) : [];
});

test('every job module loads (its SQL files exist)', async () => {
  assert.ok(jobs.length > 0);
  for (const f of jobs) await assert.doesNotReject(import(pathToFileURL(f).href), f);
});
