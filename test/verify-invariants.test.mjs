import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyInvariants } from '../scripts/verify-invariants.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const passing = '# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# todo 0\n';
function fixture(t, complete = false) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-verifier-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, value) => { const full = join(directory, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, value); };
  for (const path of ['ARCHITECTURE.json', 'VERIFY.json', 'INVARIANTS.md', 'docs/LAWS.md', 'package.json', 'packages/feedback/INVARIANTS.md']) write(path, readFileSync(join(root, path)));
  // Feature laws (VERIFY.json `features`) have their own fixture in test/pi-boundary.test.mjs; this one covers the root slots.
  { const registry = JSON.parse(readFileSync(join(directory, 'VERIFY.json'))); delete registry.features; write('VERIFY.json', JSON.stringify(registry)); }
  // Synthetic runner fixtures only. These are deliberately not library conformance.
  const body = 'import test from "node:test"; import assert from "node:assert/strict"; test("runner fixture", () => assert.equal(2+2, 4));';
  if (complete) {
    const registry = JSON.parse(readFileSync(join(directory, 'VERIFY.json')));
    for (const rule of Object.values(registry.invariants)) for (const verifier of rule.verifiers) if (verifier.scope === 'runtime') {
      verifier.kind = 'command'; delete verifier.reason; verifier.claim = 'Synthetic runner fixture, not Boring conformance';
      write(verifier.command[2], body);
    }
    write('VERIFY.json', JSON.stringify(registry));
  }
  for (const rule of Object.values(JSON.parse(readFileSync(join(directory, 'VERIFY.json'), 'utf8')).invariants)) for (const verifier of rule.verifiers) if (verifier.kind === 'command') for (const path of verifier.command.slice(2)) write(path, body);
  return { directory, write };
}

test('registered command is deduplicated across laws and executed as argv, not shell', (t) => {
  const f = fixture(t); const calls = [];
  const result = verifyInvariants(f.directory, { run: (command, args, options) => {
    calls.push(args.at(-1)); assert.equal(command, process.execPath); assert.deepEqual(args.slice(0, -1), ['--test', '--experimental-test-isolation=none', '--test-reporter=tap']);
    assert.equal(options.cwd, f.directory); assert.equal(options.timeout, 60000); assert.ok(!options.shell); assert.equal(options.env.NODE_TEST_CONTEXT, undefined);
    return { status: 0, stdout: passing };
  } });
  const registered = [...new Set(Object.values(JSON.parse(readFileSync(join(f.directory, 'VERIFY.json'), 'utf8')).invariants).flatMap((rule) => rule.verifiers.filter((v) => v.kind === 'command').map((v) => v.command[2])))];
  assert.deepEqual([...calls].sort(), registered.sort()); assert.equal(new Set(calls).size, calls.length); assert.equal(result.status, 0); // each registered file runs once, however many laws cite it
  assert.equal(result.logs.filter((line) => line.startsWith('DEFERRED')).length, 11); // six root and five feedback deferrals
  assert.ok(result.logs.some((line) => line.includes('INCOMPLETE')));
});
test('release rejects pending obligations even with no package source', (t) => {
  const f = fixture(t); const result = verifyInvariants(f.directory, { release: true, run: () => ({status:0, stdout:passing}) });
  assert.equal(result.status, 1); assert.ok(!result.logs.some((line) => line.startsWith('Registered boundary evidence passed')));
});
test('release accepts promoted mandatory slots only after actual fixture commands execute', (t) => {
  const f = fixture(t, true); const result = verifyInvariants(f.directory, { release: true });
  assert.equal(result.status, 0, result.logs.join('\n')); assert.ok(result.logs.some((line) => line.startsWith('Registered boundary evidence passed')));
});
test('release cannot pass by deleting runtime proof slots', (t) => {
  const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  for (const rule of Object.values(registry.invariants)) rule.verifiers = rule.verifiers.filter((v) => v.scope !== 'runtime');
  f.write('VERIFY.json', JSON.stringify(registry)); f.write('packages/files/src/index.ts', 'export const ready=true;');
  const result = verifyInvariants(f.directory, {release:true, run:() => ({status:0, stdout:passing})});
  assert.equal(result.status, 1); assert.ok(result.logs.some((line) => line.includes('required runtime proof slot')));
});
for (const [name, outcome] of [
  ['nonzero exit', {status:1, stderr:'failed assertion'}],
  ['spawn failure', {status:null, error:new Error('spawn failed')}],
  ['timeout/signal', {status:null, signal:'SIGTERM'}],
  ['no passing tests', {status:0, stdout:'# tests 0\n# pass 0\n# skipped 0\n# todo 0\n'}],
  ['skipped obligations', {status:0, stdout:passing.replace('# skipped 0', '# skipped 1')}],
  ['todo obligations', {status:0, stdout:passing.replace('# todo 0', '# todo 1')}],
]) test(`runner rejects ${name}`, (t) => {
  const f = fixture(t, true); assert.equal(verifyInvariants(f.directory, {release:true, run:() => outcome}).status, 1);
});
test('invalid boundary refuses execution before running evidence', (t) => {
  const f = fixture(t); f.write('packages/files/src/index.ts', 'export const fixture = true;');
  let calls = 0; const result = verifyInvariants(f.directory, {run:() => { calls++; return {status:0, stdout:passing}; }});
  assert.equal(result.status, 1); assert.equal(calls, 0);
});
