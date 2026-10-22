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
      if (proof.scope === 'runtime' && proof.kind !== 'journey') { proof.kind = 'pending'; proof.reason = 'Deliberately pending fixture'; }
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
    assert.equal(result.pending.length, Object.values(registry.invariants).filter(law => law.verifiers.some(proof => proof.kind === 'pending')).length);
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
    for (const name of ['css-stub-register.mjs', 'css-stub-hooks.mjs']) cpSync(join(root, 'scripts', name), join(dir, 'scripts', name));
    writeFileSync(join(dir, 'test/nested/fails.test.mjs'), 'import test from "node:test"; test("nested negative control", () => { throw new Error("nested sentinel"); });');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [join(dir, 'scripts/run-tests.mjs')], { encoding: 'utf8', env, timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /nested negative control/);
    assert.match(result.stdout, /nested sentinel/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function runnerFixture(t) {
  mkdirSync(join(root, '.cache'), { recursive: true });
  const dir = mkdtempSync(join(root, '.cache/boring-runner-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
  for (const name of ['run-tests.mjs', 'verify-invariants.mjs', 'check-pi-boundary.mjs', 'pi-policy.mjs', 'is-contract-only.mjs', 'implementation-evidence.mjs', 'project-files.mjs', 'run-captured.mjs', 'css-stub-register.mjs', 'css-stub-hooks.mjs']) write(`scripts/${name}`, readFileSync(join(root, 'scripts', name)));
  for (const path of ['ARCHITECTURE.json', 'VERIFY.json', 'INVARIANTS.md', 'docs/LAWS.md', 'package.json', 'packages/feedback/INVARIANTS.md']) write(path, readFileSync(join(root, path)));
  const registry = JSON.parse(readFileSync(join(dir, 'VERIFY.json'), 'utf8'));
  for (const feature of Object.values(registry.features ?? {})) write(feature.owner, readFileSync(join(root, feature.owner)));
  registry.invariants['BORING-UI-1'].verifiers.find(proof => proof.kind === 'command').command.push('test/nested/registered.test.mjs');
  write('VERIFY.json', JSON.stringify(registry));
  const registered = new Set([...Object.values(registry.invariants), ...Object.values(registry.features ?? {})].flatMap(rule => rule.verifiers.filter(proof => proof.kind === 'command').flatMap(proof => proof.command.slice(2))));
  const body = path => `import test from 'node:test'; import { appendFileSync } from 'node:fs'; test(${JSON.stringify(path)}, () => appendFileSync(process.env.TEST_RUNNER_TRACE, ${JSON.stringify(`${path}\n`)}));`;
  for (const path of registered) write(path, body(path));
  // A synthetic runtime package makes the real boundary loader supply an implementation proof too.
  write('packages/files/src/fixture.ts', 'export const fixture = true;');
  write('node_modules/@hachej/boring-files/package.json', JSON.stringify({ name: '@hachej/boring-files', type: 'module', exports: './index.mjs' }));
  write('node_modules/@hachej/boring-files/index.mjs', 'export const fixture = true;');
  registered.add('test/packages/files.test.mjs');
  write('test/packages/files.test.mjs', `import { fixture } from '@hachej/boring-files';\n${body('test/packages/files.test.mjs')}`);
  write('test/nested/unregistered.test.mjs', body('test/nested/unregistered.test.mjs'));
  const pending = Object.values(registry.invariants).flatMap(rule => rule.verifiers).find(proof => proof.kind === 'pending').command[2];
  write(pending, body(pending));
  const trace = join(dir, 'trace');
  const run = (script, args = []) => {
    writeFileSync(trace, '');
    const env = { ...process.env, TEST_RUNNER_TRACE: trace }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [join(dir, 'scripts', script), ...args], { cwd: dir, encoding: 'utf8', env, timeout: 20000 });
    return { ...result, ran: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).sort() };
  };
  return { dir, write, pending, registered: [...registered].sort(), run };
}

test('the actual CI runner and release verifier partition every discovered test exactly once', t => {
  const f = runnerFixture(t);
  assert.deepEqual(loadBoundary(f.dir).errors, []);
  const all = f.run('run-tests.mjs');
  assert.equal(all.status, 0, all.stderr || all.stdout);
  const remaining = f.run('run-tests.mjs', ['--exclude-registered']);
  assert.equal(remaining.status, 0, remaining.stderr || remaining.stdout);
  assert.deepEqual(remaining.ran, [f.pending, 'test/nested/unregistered.test.mjs'].sort());
  const registered = f.run('verify-invariants.mjs', ['--release']);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  assert.deepEqual(registered.ran, f.registered);
  assert.deepEqual([...remaining.ran, ...registered.ran].sort(), all.ran);
  assert.equal(new Set([...remaining.ran, ...registered.ran]).size, all.ran.length);
  assert.equal(all.ran.length, testFiles(join(f.dir, 'test')).length);
});

test('the CI runner refuses invalid boundary evidence rather than silently excluding it', t => {
  const f = runnerFixture(t);
  f.write('test/pi-boundary.test.mjs', 'export {};');
  const result = f.run('run-tests.mjs', ['--exclude-registered']);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /registered evidence declares no node:test tests/);
  assert.deepEqual(result.ran, []);
});

test('the actual discovery runner rejects unknown arguments and empty partitions', t => {
  const f = runnerFixture(t);
  const unknown = f.run('run-tests.mjs', ['--exclude-registerd']);
  assert.equal(unknown.status, 1, unknown.stderr || unknown.stdout);
  assert.match(unknown.stderr, /Unknown test runner argument/);
  assert.deepEqual(unknown.ran, []);
  rmSync(join(f.dir, 'test/nested/unregistered.test.mjs'));
  rmSync(join(f.dir, f.pending));
  const empty = f.run('run-tests.mjs', ['--exclude-registered']);
  assert.equal(empty.status, 1, empty.stderr || empty.stdout);
  assert.match(empty.stderr, /No tests discovered/);
  assert.deepEqual(empty.ran, []);
});

test('the scaffold retains every policy-required runtime proof slot', () => {
  const registry = JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8'));
  const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
  for (const [id, file] of Object.entries(policy.runtimeProofs)) {
    const proofs = registry.invariants[id].verifiers.filter((v) => v.scope === 'runtime');
    assert.equal(proofs.length, 1, id);
    assert.deepEqual(proofs[0].command, Array.isArray(file) ? file : ['node', '--test', file]);
    assert.ok((Array.isArray(file) ? ['journey'] : ['pending', 'command']).includes(proofs[0].kind));
  }
});
