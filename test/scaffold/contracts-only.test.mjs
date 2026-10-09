import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured as spawnSync } from '../../scripts/run-captured.mjs';
import test from 'node:test';
import { isContractOnly } from '../../scripts/is-contract-only.mjs';
import { loadBoundary } from '../../scripts/check-pi-boundary.mjs';
import { testFiles } from '../../scripts/run-tests.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('only whole-statement erased type declarations qualify', () => {
  assert.equal(isContractOnly('x.ts', 'import type { X } from "x"; export interface A { x: X }; export type B = A; export type { X };'), true);
  assert.equal(isContractOnly('x.ts', 'export {};'), true);
  for (const source of [
    'export const x = 1;', 'export function attach() {}', 'declare function attach(): void;',
    'export class X {}', 'export enum X { A }', 'namespace X {}',
    'import "side-effect";', 'import { type X } from "side-effect";',
    'export {} from "side-effect";', 'export { type X } from "side-effect";',
    'export * from "runtime";', 'await Promise.resolve();', 'const x = ;',
  ]) assert.equal(isContractOnly('x.ts', source), false, source);
  assert.equal(isContractOnly('x.js', 'export {};'), false);
});

test('type scaffold does not discharge pending proofs; executable and ambient stubs still block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-interface-gate-'));
  try {
    for (const file of ['ARCHITECTURE.json', 'INVARIANTS.md', 'package.json', '.gitignore']) cpSync(join(root, file), join(dir, file));
    // A git checkout with the repository's .gitignore: checks skip exactly what git ignores (package-root dist, not src/dist).
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // Fixture controls its deferrals; legitimate future implementation may
    // promote the real repository's slots with actual runtime evidence.
    const registry = JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8'));
    for (const law of Object.values(registry.invariants)) for (const proof of law.verifiers) {
      if (proof.scope === 'runtime') { proof.kind = 'pending'; proof.reason = 'Deliberately pending fixture'; }
    }
    delete registry.features; // feature laws have their own fixture in test/pi-boundary.test.mjs
    writeFileSync(join(dir, 'VERIFY.json'), JSON.stringify(registry));
    mkdirSync(join(dir, 'docs'));
    cpSync(join(root, 'docs/LAWS.md'), join(dir, 'docs/LAWS.md'));
    mkdirSync(join(dir, 'packages/feedback'), { recursive: true });
    cpSync(join(root, 'packages/feedback/INVARIANTS.md'), join(dir, 'packages/feedback/INVARIANTS.md'));
    mkdirSync(join(dir, 'test'));
    cpSync(join(root, 'test/pi-boundary.test.mjs'), join(dir, 'test/pi-boundary.test.mjs'));
    // Other registered structural tests import built packages this fixture lacks; a declared stub stands in for them.
    for (const law of Object.values(registry.invariants)) for (const proof of law.verifiers) if (proof.kind === 'command') for (const path of proof.command.slice(2)) if (path !== 'test/pi-boundary.test.mjs') {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), 'import test from "node:test"; test("structural fixture stub", () => {});');
    }
    mkdirSync(join(dir, 'packages/files/src'), { recursive: true });
    const source = join(dir, 'packages/files/src/example.ts');
    writeFileSync(source, 'export interface Example { readonly id: string }');
    let result = loadBoundary(dir);
    assert.deepEqual(result.errors, []);
    assert.equal(result.contracts, 1);
    assert.equal(result.pending.length, Object.keys(registry.invariants).length);
    for (const code of ['export const impl = 1;', 'export declare function impl(): void;', 'import "isomorphic-git";']) {
      writeFileSync(source, code);
      result = loadBoundary(dir);
      assert.ok(result.errors.some((error) => error.includes('Missing package implementation tests')), code);
    }
    writeFileSync(source, 'export interface Example { readonly id: string }');
    mkdirSync(join(dir, 'packages/files/dist'), { recursive: true });
    writeFileSync(join(dir, 'packages/files/dist/example.js'), 'export {};');
    assert.deepEqual(loadBoundary(dir).errors, []);
    mkdirSync(join(dir, 'packages/files/src/dist'));
    writeFileSync(join(dir, 'packages/files/src/dist/hidden.ts'), 'export const notHidden = 1;');
    assert.ok(loadBoundary(dir).errors.some((error) => error.includes('Missing package implementation tests')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nested tests are discovered deterministically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-test-discovery-'));
  try {
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested/fails.test.mjs'), 'throw new Error("expected");');
    writeFileSync(join(dir, 'not-a-test.mjs'), '');
    assert.deepEqual(testFiles(dir), [join(dir, 'nested/fails.test.mjs')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failing nested test makes the actual discovery runner fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-test-negative-control-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'test/nested'), { recursive: true });
    cpSync(join(root, 'scripts/run-tests.mjs'), join(dir, 'scripts/run-tests.mjs'));
    writeFileSync(join(dir, 'test/nested/fails.test.mjs'), 'import test from "node:test"; test("nested negative control", () => { throw new Error("nested sentinel"); });');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [join(dir, 'scripts/run-tests.mjs')], { encoding: 'utf8', env, timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /nested negative control/);
    assert.match(result.stdout, /nested sentinel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the scaffold retains every policy-required runtime proof slot', () => {
  const registry = JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8'));
  const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
  for (const [id, file] of Object.entries(policy.runtimeProofs)) {
    const proofs = registry.invariants[id].verifiers.filter((v) => v.scope === 'runtime');
    assert.equal(proofs.length, 1, id);
    assert.deepEqual(proofs[0].command, ['node', '--test', file]);
    assert.ok(['pending', 'command'].includes(proofs[0].kind));
  }
});
