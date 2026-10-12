import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadBoundary } from '../../scripts/check-pi-boundary.mjs';
import { verifyInvariants } from '../../scripts/verify-invariants.mjs';
import { importsPackage } from '../../scripts/implementation-evidence.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-development-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const path of ['ARCHITECTURE.json', 'VERIFY.json', 'INVARIANTS.md', 'package.json', 'docs/LAWS.md', 'packages/feedback/INVARIANTS.md']) write(path, readFileSync(join(repository, path)));
  // Fixture controls evidence status independently of later real implementations.
  const registry = JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8'));
  for (const law of Object.values(registry.invariants)) for (const proof of law.verifiers) if (proof.scope === 'runtime') { proof.kind = 'pending'; proof.reason = 'deliberately unqualified fixture'; }
  // Feature laws (VERIFY.json `features`) have their own fixture in test/pi-boundary.test.mjs; this one covers the root slots.
  delete registry.features;
  write('VERIFY.json', JSON.stringify(registry));
  for (const law of Object.values(registry.invariants)) for (const proof of law.verifiers) if (proof.kind === 'command') for (const path of proof.command.slice(2)) write(path, 'import test from "node:test"; import assert from "node:assert/strict"; test("structural fixture", () => assert.equal(1, 1));');
  write('packages/files/package.json', JSON.stringify({ name: '@hachej/boring-files', version: '0.0.0', type: 'module', exports: './src/index.mjs' }));
  write('packages/files/src/index.mjs', 'export const projectLabel = value => value.trim();');
  mkdirSync(join(root, 'node_modules/@hachej'), { recursive: true });
  symlinkSync(join(root, 'packages/files'), join(root, 'node_modules/@hachej/boring-files'), 'dir');
  return { root, write };
}
const packageTest = 'import test from "node:test"; import assert from "node:assert/strict"; import { projectLabel } from "@hachej/boring-files"; test("actual fixture package behavior", () => assert.equal(projectLabel(" name "), "name"));';

test('implemented package needs its own tests, not unrelated completed runtime proofs', t => {
  const f = fixture(t);
  assert.ok(loadBoundary(f.root).errors.some(error => error.includes('Missing package implementation tests')));
  f.write('test/packages/files.test.mjs', packageTest);
  const boundary = loadBoundary(f.root);
  assert.deepEqual(boundary.errors, []);
  assert.equal(boundary.pending.length, 14); // six root and eight feedback deferrals
  assert.deepEqual(boundary.implementationProofs.map(p => p.package), ['files']);
  const dev = verifyInvariants(f.root);
  assert.equal(dev.status, 0, dev.logs.join('\n'));
  const release = verifyInvariants(f.root, { release: true });
  assert.equal(release.status, 0, release.logs.join('\n')); // deferred proofs are backlog (owner ruling 2026-10-10), not blockers
  assert.ok(release.logs.some(line => line.includes('14 deferred proofs')));
  assert.equal(release.deferred.length, 14);
});

test('a real package regression fails development verification', t => {
  const f = fixture(t); f.write('test/packages/files.test.mjs', packageTest);
  f.write('packages/files/src/index.mjs', 'export const projectLabel = value => value;');
  const result = verifyInvariants(f.root);
  assert.equal(result.status, 1);
  assert.ok(result.logs.some(line => line.includes('Evidence failed')));
});

test('skipped package assertions cannot be counted as implementation evidence', t => {
  const f = fixture(t);
  f.write('test/packages/files.test.mjs', packageTest.replace('test("actual fixture', 'test.skip("actual fixture'));
  assert.equal(verifyInvariants(f.root).status, 1);
});

test('a test of a surrogate without importing the implementation is insufficient', t => {
  const f = fixture(t);
  f.write('test/packages/files.test.mjs', 'import test from "node:test"; test("surrogate", () => {});');
  assert.ok(loadBoundary(f.root).errors.some(error => error.includes('must import @hachej/boring-files')));
});

test('package evidence cannot escape through symlinks', t => {
  const f = fixture(t); f.write('other.mjs', packageTest);
  mkdirSync(join(f.root, 'test/packages'), { recursive: true });
  symlinkSync(join(f.root, 'other.mjs'), join(f.root, 'test/packages/files.test.mjs'));
  assert.ok(loadBoundary(f.root).errors.some(error => error.includes('evidence symlink')));
});

test('public-import wiring check does not count strings, comments or other packages', () => {
  assert.equal(importsPackage('/* import "@hachej/boring-files" */ const s="@hachej/boring-files";', 'files'), false);
  assert.equal(importsPackage('import "@hachej/boring-filesystem";', 'files'), false);
  assert.equal(importsPackage('await import("@hachej/boring-files/contracts");', 'files'), true);
  assert.equal(importsPackage('import { read } from "@hachej/boring-files";', 'files'), true);
});
