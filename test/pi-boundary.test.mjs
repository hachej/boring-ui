import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkManifest, checkSource } from '../scripts/pi-policy.mjs';
import { checkHostExecution, loadBoundary, scanHostExecution, scanNativeReload } from '../scripts/check-pi-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
const source = (body, owner = 'agent', file = `packages/${owner}/src/example.ts`) => checkSource(file, body, policy);
const forbidden = (body, owner = 'agent') => assert.ok(source(body, owner).length, body);
const accepted = (body, owner = 'agent', file) => assert.deepEqual(source(body, owner, file), [], body);

for (const [name, body, owner] of [
  ['private durable source', 'import { Harness } from "@earendil-works/pi-durable/src/index.ts"'],
  ['unexported durable module', 'import { Scheduler } from "@earendil-works/pi-durable/harness/scheduler"'],
  ['source re-export', 'export { Harness } from "@earendil-works/pi-durable/dist/index.js"'],
  ['type-only private import', 'import type { Task } from "@earendil-works/pi-durable/src/types.ts"'],
  ['import-equals private module', 'import pi = require("@earendil-works/pi-durable/src/index.ts");'],
  ['import-equals construction', 'import pi = require("@earendil-works/pi-durable"); pi.Harness.open(storage, options);'],
  ['computed import', 'const value = await import(path)'],
  ['computed require', 'const value = require(path)'],
  ['shadow scheduler', 'export class BoringScheduler {}'],
  ['shadow harness', 'export class BoringHarness {}'],
  ['reserved task kind', 'import { defineTask } from "@earendil-works/pi-durable"; defineTask({ name: "pi.generation" })'],
  ['aliased reserved document kind', 'import { defineDoc as doc } from "@earendil-works/pi-durable"; doc({ kind: "pi.agent" })'],
  ['ordinary open', 'import { Harness } from "@earendil-works/pi-durable"; Harness.open(storage, options)'],
  ['aliased open', 'import { Harness as H } from "@earendil-works/pi-durable"; H.open(storage, options)'],
  ['namespace open', 'import * as pi from "@earendil-works/pi-durable"; pi.Harness.open(storage, options)'],
  ['computed literal open', 'import { Harness as H } from "@earendil-works/pi-durable"; H["open"](storage, options)'],
  ['required alias open', 'const { Harness: H } = require("@earendil-works/pi-durable"); H.open(storage, options)'],
  ['second alias open', 'import { Harness as H } from "@earendil-works/pi-durable"; const Other = H; Other.open(storage, options)'],
  ['destructured namespace open', 'import * as Pi from "@earendil-works/pi-durable"; const {Harness: H} = Pi; H.open(store, opts);'],
  ['awaited dynamic open', 'const {Harness: H} = await import("@earendil-works/pi-durable"); H.open(store, opts);'],
  ['assignment alias open', 'import {Harness as H} from "@earendil-works/pi-durable"; let Other; Other = H; Other.open(store, opts);'],
  ['bound open', 'import {Harness as H} from "@earendil-works/pi-durable"; const run = H.open.bind(H); run(store, opts);'],
  ['qualified import-equals', 'import * as Pi from "@earendil-works/pi-durable"; import H = Pi.Harness; H.open(store, opts);'],
  ['call open', 'import {Harness as H} from "@earendil-works/pi-durable"; H.open.call(H, store, opts);'],
  ['constructor', 'import { Harness } from "@earendil-works/pi-durable"; new Harness(storage)'],
  ['kernel subclass', 'import { Harness as H } from "@earendil-works/pi-durable"; class Custom extends H {}'],
  ['prototype assignment', 'import { Harness as H } from "@earendil-works/pi-durable"; H.prototype.close = replacement'],
  ['reflective patch', 'import { Harness as H } from "@earendil-works/pi-durable"; Object.defineProperty(H.prototype, "close", {value: replacement})'],
  ['delete kernel method', 'import { Harness as H } from "@earendil-works/pi-durable"; delete H.prototype.close'],
  ['increment kernel member', 'import {Harness as H} from "@earendil-works/pi-durable"; H.prototype.close++;'],
  ['decrement kernel member', 'import {Harness as H} from "@earendil-works/pi-durable"; --H.prototype.close;'],
  ['constant declaration object', 'import {defineTask} from "@earendil-works/pi-durable"; const declaration={name:"pi.generation"}; defineTask(declaration);'],
  ['constant reserved name', 'import {defineTask} from "@earendil-works/pi-durable"; const kind="pi.generation"; defineTask({name:kind});'],
  ['call reserved declaration', 'import {defineTask} from "@earendil-works/pi-durable"; defineTask.call(undefined, {name:"pi.generation"});'],
  ['apply reserved declaration', 'import {defineTask} from "@earendil-works/pi-durable"; defineTask.apply(undefined, [{name:"pi.generation"}]);'],
  ['satisfies declaration object', 'import {defineTask} from "@earendil-works/pi-durable"; const declaration={name:"pi.generation"} satisfies Record<string,string>; defineTask(declaration);'],
  ['opaque native member', 'import * as pi from "@earendil-works/pi-durable"; pi[chosen]'],
  ['generated function', 'new Function(code)'],
  ['UI runtime Pi', 'import { Harness } from "@earendil-works/pi-durable"', 'ui'],
  ['UI runtime agent', 'import { setup } from "@hachej/boring-agent"', 'ui'],
  ['files to exec', 'import { exec } from "@hachej/boring-execution"', 'files'],
  ['files to process', 'import { exec } from "node:child_process"', 'files'],
  ['agent to execution', 'import { exec } from "@hachej/boring-execution"'],
  ['relative package bypass', 'import { Harness } from "../../agent/src/index.ts"', 'ui'],
  ['repository private subpath', 'import { store } from "@hachej/boring-agent/src/store.ts"', 'ui'],
]) test(`rejects mutant: ${name}`, () => forbidden(body, owner));

test('owned convenience factory may open a native Harness', () => accepted('import { Harness } from "@earendil-works/pi-durable"; Harness.open(storage, options)', 'agent', policy.harnessFactory));
test('native optional extension/task/doc is allowed', () => accepted('import { defineExtension, defineTask, defineDoc } from "@earendil-works/pi-durable"; const ask = defineDoc({kind:"boring.ask-user"}); const wait = defineTask({name:"boring.ask-user.wait"}); defineExtension({name:"ask-user", tasks:[wait]});'));
test('borrowed native Harness operations need no constructor', () => accepted('import type { Harness } from "@earendil-works/pi-durable"; export const attach = (h: Harness) => h.watchTaskGraph(context);'));
test('optional UI adapters can consume native/resource types without an agent facade', () => accepted('import type { ConversationView } from "@earendil-works/pi-durable"; export type { ResourceRef } from "@hachej/boring-files"; type Native = import("@earendil-works/pi-durable").ConversationId;', 'ui'));
test('UI cannot reintroduce an agent-schema dependency', () => forbidden('import type { RuntimeSchema } from "@hachej/boring-agent";', 'ui'));
test('mixed runtime/type import is not incorrectly treated as type-only', () => forbidden('import { type ConversationView, Harness } from "@earendil-works/pi-durable"', 'ui'));
test('files can use virtual Git with no execution dependency', () => accepted('import git from "isomorphic-git"; export const status = (fs) => git.status({fs,dir:"/repo",filepath:"note.md"});', 'files'));
test('execution adapter uses public native interfaces and resource integration', () => accepted('import type { ExecutionEnv } from "@earendil-works/pi-durable/env"; import { fileProvider } from "@hachej/boring-files";', 'execution'));
test('workspace acquisition cannot depend on an agent facade', () => forbidden('import type { HostOperation } from "@hachej/boring-agent";', 'execution'));
test('documented public provider module is not treated as private', () => accepted('import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";'));
test('mutable registration name is not folded as an immutable initializer', () => accepted('import {defineTask} from "@earendil-works/pi-durable"; let kind="pi.generation"; kind="boring.task"; defineTask({name:kind});'));
test('shadowed parameter is not an upstream import', () => accepted('import {Harness as H} from "@earendil-works/pi-durable"; function local(H) { H.open(); }'));
test('shadowed block binding is not an upstream import', () => accepted('import {Harness as H} from "@earendil-works/pi-durable"; function local() { const H = hostObject; H.open(); }'));
test('native view interface extension is not runtime subclassing', () => accepted('import type {ConversationView} from "@earendil-works/pi-durable"; interface HostView extends ConversationView {}', 'ui'));
test('comments and string literals do not become import findings', () => accepted('// import x from "@earendil-works/pi-durable/src/index.ts"\nconst example = "Harness.open(storage)";'));
test('root tooling dependency/version is explicit policy', () => assert.deepEqual(checkManifest({devDependencies:{typescript:'5.9.3'}}, undefined, policy), []));
test('local upstream dependency is refused', () => assert.ok(checkManifest({dependencies:{'@earendil-works/pi-durable':'file:../pi'}}, 'agent', policy).some((p) => p.includes('forked'))));
test('pnpm patch reference is refused', () => assert.ok(checkManifest({pnpm:{patchedDependencies:{'@earendil-works/pi-durable':'patches/pi.patch'}}}, undefined, policy).length));
test('version-qualified pnpm patch reference is refused', () => assert.ok(checkManifest({pnpm:{patchedDependencies:{'@earendil-works/pi-durable@1.0.1':'patches/custom.patch'}}}, undefined, policy).length));
test('unknown package is refused', () => assert.ok(checkManifest({}, 'scheduler', policy).length));
test('nested upstream override cannot swap a fork', () => assert.ok(checkManifest({overrides:{'@earendil-works/pi-durable':{'.':'file:../fork'}}}, undefined, policy).some((p) => p.includes('local/forked/patched'))));
test('wildcard upstream resolution cannot swap a fork', () => assert.ok(checkManifest({resolutions:{'**/@earendil-works/pi-durable':'file:../fork'}}, undefined, policy).some((p) => p.includes('local/forked/patched'))));
test('experimental upstream version is pinned to reviewed exports', () => {
  const manifest = { name: '@hachej/boring-agent', dependencies: { '@earendil-works/pi-durable': '1.1.0' } };
  assert.deepEqual(checkManifest(manifest, 'agent', policy), []);
  manifest.dependencies['@earendil-works/pi-durable'] = '^1.1.0';
  assert.ok(checkManifest(manifest, 'agent', policy).some((p) => p.includes('version must match')));
});
test('npm alias cannot swap a fork for upstream', () => {
  assert.ok(checkManifest({name:'@hachej/boring-agent', dependencies:{'@earendil-works/pi-durable':'npm:replacement@1.0.0'}}, 'agent', policy).some((p) => p.includes('local/forked/patched')));
});

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-pi-policy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (path, content) => { const full = join(directory, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content); };
  for (const path of ['ARCHITECTURE.json', 'VERIFY.json', 'INVARIANTS.md', 'docs/LAWS.md', 'package.json', 'packages/feedback/INVARIANTS.md']) write(path, readFileSync(join(root, path)));
  // Feature laws name their owner and structural evidence files; the fixture carries them too.
  for (const feature of Object.values(JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8')).features ?? {})) {
    for (const path of [feature.owner, ...feature.verifiers.flatMap((v) => v.kind === 'command' ? v.command.slice(2) : [])]) write(path, readFileSync(join(root, path)));
  }
  // Every registered structural test file gets the synthetic body: registration, not the real test, is checked here.
  for (const rule of Object.values(JSON.parse(readFileSync(join(root, 'VERIFY.json'), 'utf8')).invariants)) for (const verifier of rule.verifiers) if (verifier.kind === 'command') for (const path of verifier.command.slice(2)) write(path, 'import test from "node:test"; test("synthetic registry fixture, not runtime conformance", () => {});');
  write('test/pi-boundary.test.mjs', 'import test from "node:test"; test("synthetic registry fixture, not runtime conformance", () => {});');
  return { directory, write };
}
test('empty specification is structurally valid and reports the six root and five feedback deferred proofs (FEEDBACK-3, 5 and 7 discharged by WP9)', (t) => {
  const f = fixture(t); const result = loadBoundary(f.directory);
  assert.deepEqual(result.errors, []); assert.equal(result.sources, 0);
  assert.equal(result.pending.filter((p) => p.id.startsWith('BORING-PI-')).length, 6);
  assert.deepEqual(result.pending.filter((p) => p.id.startsWith('FEEDBACK-')).map((p) => p.id), ['FEEDBACK-1', 'FEEDBACK-2', 'FEEDBACK-4', 'FEEDBACK-6', 'FEEDBACK-8']);
});
test('package-owned laws: missing index row, missing runtime slot and wrong applicability fail', (t) => {
  const f = fixture(t);
  f.write('docs/LAWS.md', readFileSync(join(root, 'docs/LAWS.md'), 'utf8').replace(/^\| FEEDBACK-3 \|.*$/m, ''));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('not indexed: FEEDBACK-3')));
  const g = fixture(t); const architecture = JSON.parse(readFileSync(join(g.directory, 'ARCHITECTURE.json')));
  delete architecture.runtimeProofs['FEEDBACK-2']; g.write('ARCHITECTURE.json', JSON.stringify(architecture));
  assert.ok(loadBoundary(g.directory).errors.some((p) => p.includes('unmatched')));
  const h = fixture(t); const registry = JSON.parse(readFileSync(join(h.directory, 'VERIFY.json')));
  registry.invariants['FEEDBACK-1'].appliesTo = ['ui']; h.write('VERIFY.json', JSON.stringify(registry));
  assert.ok(loadBoundary(h.directory).errors.some((p) => p.includes('does not apply to its owner: FEEDBACK-1')));
});
test('package-owned laws: a law defined twice across owners or in another document fails', (t) => {
  const f = fixture(t); f.write('packages/ui/INVARIANTS.md', '## FEEDBACK-1 — copied\n');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('defined twice: FEEDBACK-1')));
  const g = fixture(t); g.write('docs/architecture/OTHER.md', '## FEEDBACK-2 — copied\n');
  assert.ok(loadBoundary(g.directory).errors.some((p) => p.includes('defined twice: FEEDBACK-2')));
});
test('package-owned laws: an owner that is not its package, an unknown package or the root prefix is refused', (t) => {
  for (const entry of [
    { owner: 'packages/ui/INVARIANTS.md', prefix: 'FEEDBACK', package: 'feedback' },
    { owner: 'packages/nowhere/INVARIANTS.md', prefix: 'FEEDBACK', package: 'nowhere' },
    { owner: 'packages/feedback/INVARIANTS.md', prefix: 'BORING', package: 'feedback' },
  ]) {
    const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
    registry.packageLaws = [entry]; f.write('VERIFY.json', JSON.stringify(registry));
    assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('invalid package law owner')), JSON.stringify(entry));
  }
});
test('package-owned laws leave the root laws unchanged', (t) => {
  const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  registry.invariants['BORING-PI-6'].verifiers[1].command = ['node', '--test', 'test/contracts/other.test.mjs']; f.write('VERIFY.json', JSON.stringify(registry));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('missing/changed required runtime proof slot: BORING-PI-6')));
});
test('new library behavior requires package implementation tests', (t) => {
  const f = fixture(t); f.write('packages/files/src/index.ts', 'export const ready = true;');
  assert.ok(loadBoundary(f.directory).errors.some((p) => /Missing package implementation tests/.test(p)));
});
test('removing runtime obligations does not allow source', (t) => {
  const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  for (const rule of Object.values(registry.invariants)) rule.verifiers = rule.verifiers.filter((v) => v.scope !== 'runtime');
  f.write('VERIFY.json', JSON.stringify(registry)); f.write('packages/files/src/index.ts', 'export const ready=true;');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('required runtime proof slot')));
});
test('structural evidence cannot be relabelled as runtime proof', (t) => {
  const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  const proof = registry.invariants['BORING-PI-1'].verifiers[1]; proof.kind = 'command'; proof.command = ['node', '--test', 'test/pi-boundary.test.mjs'];
  f.write('VERIFY.json', JSON.stringify(registry));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('required runtime proof slot')));
});
test('source roots cannot omit package scanning', (t) => {
  const f = fixture(t); const altered = structuredClone(policy); altered.sourceRoots = [];
  f.write('ARCHITECTURE.json', JSON.stringify(altered));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('source roots must cover')));
});
test('missing registered evidence fails the structural gate', (t) => {
  const f = fixture(t); rmSync(join(f.directory, 'test/pi-boundary.test.mjs'));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('missing registered test')));
});
test('empty evidence file cannot be promoted to a verifier', (t) => {
  const f = fixture(t); f.write('test/pi-boundary.test.mjs', '// not a test');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('declares no')));
});
test('orphan root law and missing index fail', (t) => {
  const f = fixture(t); f.write('INVARIANTS.md', '# Laws\n## BORING-PI-9 — orphan\n'); f.write('docs/LAWS.md', '# Empty index');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('unmatched')));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('not indexed')));
});
test('duplicate law definition is rejected', (t) => {
  const f = fixture(t); f.write('packages/agent/INVARIANTS.md', '## BORING-PI-1 — duplicate\n');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('defined twice')));
});
test('arbitrary shell evidence command is rejected', (t) => {
  const f = fixture(t); const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  registry.invariants['BORING-PI-1'].verifiers[0].command = ['bash', '-c', 'true']; f.write('VERIFY.json', JSON.stringify(registry));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('invalid test command')));
});
test('vendored Pi and patch files are refused', (t) => {
  const f = fixture(t); f.write('vendor/pi-durable/copied.js', '// upstream copied runtime'); f.write('patches/custom.patch', 'node_modules/@earendil-works/pi-ai/dist/api.js');
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('vendored upstream')));
  assert.ok(loadBoundary(f.directory).errors.some((p) => p.includes('patched upstream')));
});

// SELF-2: agent-written content is never evaluated or loaded into a host process (packages/ and examples/).
for (const [name, body] of [
  ['eval', 'eval(text)'], ['global eval', 'globalThis.eval(text)'], ['Function constructor', 'new Function("return " + text)()'], ['Function call', 'Function(text)()'],
  ['computed import', 'await import(path)'], ['relative template import', 'await import(`./.agent/tools/${name}.mjs`)'], ['file URL import', 'await import(pathToFileURL(workspaceFile).href)'],
  ['URL outside the module', 'await import(new URL(name, workspaceRoot))'], ['computed require', 'require(path)'], ['node:vm', 'import vm from "node:vm"'], ['vm', 'import { runInNewContext } from "vm"'],
]) test(`SELF-2 refuses ${name}`, () => assert.ok(scanHostExecution('examples/fixture.mjs', body).length, body));
for (const [name, body] of [
  ['literal import', 'await import("@earendil-works/pi-ai/providers/openai")'], ['package template import', 'await import(`@earendil-works/pi-ai/providers/${provider}`)'],
  ['own folder URL', 'await import(new URL(name, import.meta.url))'], ['literal require', 'require("node:fs")'], ['code in a string for a sandbox', 'const code = "return require(name) + eval(x)"'],
]) test(`SELF-2 accepts ${name}`, () => assert.deepEqual(scanHostExecution('examples/fixture.mjs', body), [], body));
// SELF-4: reload changes tools only through the host's native registry.
for (const [name, body] of [
  ['a second registry', 'import { createRegistry } from "@earendil-works/pi-durable"; const own = createRegistry(); registry.install(x);'],
  ['a non-native registry change', 'registry.install(x); registry.replaceTools(x);'],
  ['reading the registry snapshot', 'registry.install(x); const tools = api.registry.snapshot();'],
  ['no native install at all', 'const tools = new Map(); tools.set(name, tool);'],
]) test(`SELF-4 refuses ${name}`, () => assert.ok(scanNativeReload('packages/agent/src/self-evolving.ts', body).length, body));
test('SELF-4 accepts native install and uninstall', () => assert.deepEqual(scanNativeReload('packages/agent/src/self-evolving.ts', 'for (const registry of registries) registry.install(current); registry.uninstall(current);'), []));
test('SELF-2: the packages and examples of this repository pass the rule', () => {
  const result = checkHostExecution(root);
  assert.deepEqual(result.errors, []); assert.ok(result.files > 100);
});
test('feature laws need their owner, index entry, structural command and a named journey', (t) => {
  const f = fixture(t); assert.deepEqual(loadBoundary(f.directory).errors, []);
  const registry = JSON.parse(readFileSync(join(f.directory, 'VERIFY.json')));
  registry.features['SELF-1'].verifiers = registry.features['SELF-1'].verifiers.filter((v) => v.scope !== 'runtime');
  registry.features['SELF-2'].verifiers[1].kind = 'command';
  registry.features['SELF-3'].verifiers[1].env = {};
  f.write('VERIFY.json', JSON.stringify(registry)); f.write('docs/LAWS.md', '# Index without features\n| BORING-PI-1 |\n| BORING-PI-2 |\n| BORING-PI-3 |\n| BORING-PI-4 |\n| BORING-PI-5 |\n| BORING-PI-6 |\n');
  const errors = loadBoundary(f.directory).errors;
  for (const expected of ['feature law needs structural and runtime evidence: SELF-1', 'invalid journey command: SELF-2', 'journey evidence must name its selector: SELF-3', 'law is not indexed: SELF-4']) assert.ok(errors.includes(expected), `${expected} in ${errors.join('; ')}`);
});
// FEEDBACK-5, structural part: folder import rules inside @hachej/boring-feedback and the one-way edge from
// existing packages. Not runtime evidence that the parts behave independently.
const check = (file, body) => checkSource(file, body, policy);

for (const [name, file, body] of [
  ['page imports the agent package', 'packages/feedback/src/page/picker.ts', 'import { defineAgent } from "@hachej/boring-agent/agents";'],
  ['page imports Pi', 'packages/feedback/src/page/x.ts', 'import type { Harness } from "@earendil-works/pi-durable";'],
  ['page imports node', 'packages/feedback/src/page/x.ts', 'import { readFileSync } from "node:fs";'],
  ['page reaches into the store folder', 'packages/feedback/src/page/x.ts', 'import { createFeedbackStore } from "../store/index.js";'],
  ['ui reaches into the agent folder', 'packages/feedback/src/ui/x.tsx', 'import { createFeedbackCapability } from "../agent/index.js";'],
  ['format imports the platform', 'packages/feedback/src/format/x.ts', 'import { randomUUID } from "@hachej/boring-files/platform";'],
  ['format reaches into page', 'packages/feedback/src/format/x.ts', 'import { serializePage } from "../page/index.js";'],
  ['store imports React', 'packages/feedback/src/store/x.ts', 'import { useState } from "react";'],
  ['store imports the Pi runtime', 'packages/feedback/src/store/x.ts', 'import { defineTool } from "@earendil-works/pi-durable";'],
  ['source imports the Pi runtime', 'packages/feedback/src/source/x.ts', 'import { Type } from "@earendil-works/pi-ai";'],
  ['agent reaches into ui', 'packages/feedback/src/agent/x.ts', 'import { copyReport } from "../ui/index.js";'],
  ['an existing package imports feedback', 'packages/ui/src/x.ts', 'import type { FeedbackReport } from "@hachej/boring-feedback/format";'],
  ['files imports feedback', 'packages/files/src/x.ts', 'import { parseFeedback } from "@hachej/boring-feedback/format";'],
  ['feedback imports an undeclared ui runtime entry', 'packages/feedback/src/page/x.ts', 'import { MarkdownEditor } from "@hachej/boring-ui-kit/markdown-editor";'],
]) test(`feedback refused: ${name}`, () => assert.ok(check(file, body).length, `${file}: ${body}`));

for (const [name, file, body] of [
  ['format type-imports ui contracts and files', 'packages/feedback/src/format/x.ts', 'import type { Anchor } from "@hachej/boring-ui-kit/contracts"; import type { ResourceLocator } from "@hachej/boring-files";'],
  ['page uses the platform at runtime', 'packages/feedback/src/page/x.ts', 'import { copyToClipboard } from "@hachej/boring-files/platform";'],
  ['page reaches into format', 'packages/feedback/src/page/x.ts', 'import type { FeedbackReport } from "../format/index.js";'],
  ['store uses format and the platform', 'packages/feedback/src/store/x.ts', 'import type { FeedbackReport } from "../format/index.js"; import { randomUUID } from "@hachej/boring-files/platform";'],
  ['agent type-imports Pi', 'packages/feedback/src/agent/x.ts', 'import type { ToolRegistration } from "@earendil-works/pi-durable";'],
  ['agent defines its native extension with the Pi runtime', 'packages/feedback/src/agent/x.ts', 'import { defineExtension, defineTool } from "@earendil-works/pi-durable"; import { Type } from "@earendil-works/pi-ai";'],
]) test(`feedback accepted: ${name}`, () => assert.deepEqual(check(file, body), [], `${file}: ${body}`));


test('npm migration accepts only the canonical UI kit identity', () => {
  accepted('import { registerViewer } from "@hachej/boring-ui-kit";', 'ui');
  for (const name of ['@hachej/boring-ui', '@hachej/boring-ui/resources', '@hachej/boring-ui-kitten']) {
    forbidden(`import { value } from "${name}";`, 'ui');
    const manifest = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
    manifest.peerDependencies[name] = '1.0.0';
    assert.ok(checkManifest(manifest, 'agent', policy).length, name);
  }
});
