import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('repo verification CLI enforces the configured repository and source graph', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'scripts/verify-repo.config.json'), 'utf8'));
  assert.ok(config.allowedTopLevel.includes('packages'));
  assert.ok(config.allowedTopLevel.includes('registry'));
  assert.ok(config.sizeWarnings.sourceLines > 0);
  assert.ok(config.additionalSourceRoots.some(({ path, reason }) => path === 'packages/browser/src/shims' && reason));

  const result = spawnSync(process.execPath, ['scripts/verify-repo.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /verify:repo passed: .*package sources reachable/);
  assert.match(result.stdout, /specialized boundaries and feature map passed/);
  assert.match(result.stderr, /WARN large source/);
});
