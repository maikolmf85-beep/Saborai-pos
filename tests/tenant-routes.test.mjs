import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pathFromRoot = (relative) => fileURLToPath(new URL(relative, root));

function countEntrypoints(directory) {
  let count = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const fullPath = `${directory}/${entry.name}`;
    if (entry.isDirectory()) count += countEntrypoints(fullPath);
    else if (/\.(?:ts|js)$/.test(entry.name)) count += 1;
  }
  return count;
}

test('preserva las rutas públicas tenant y queda bajo el límite Hobby de 12 funciones', () => {
  const config = JSON.parse(readFileSync(pathFromRoot('vercel.json'), 'utf8'));
  const rewrites = new Map(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
  assert.equal(rewrites.get('/api/tenant/onboarding'), '/api/tenant?action=onboarding');
  assert.equal(rewrites.get('/api/tenant/profile'), '/api/tenant?action=profile');
  assert.equal(rewrites.get('/api/tenant/floorplan'), '/api/tenant?action=floorplan');
  assert.equal(existsSync(pathFromRoot('api/tenant.ts')), true);
  assert.equal(existsSync(pathFromRoot('api/_utils/branchFloorplan.ts')), true);
  assert.equal(existsSync(pathFromRoot('api/tenant/onboarding.ts')), false);
  assert.equal(existsSync(pathFromRoot('api/tenant/profile.ts')), false);
  assert.equal(countEntrypoints(pathFromRoot('api')), 12);
});
