import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzeOneHarness, checkOneHarness, scanOneHarness } from '../scripts/check-pi-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PI = 'import { createModels } from "@earendil-works/pi-ai/models";';
const refused = (name, body) => test(`one harness refuses: ${name}`, () => assert.ok(scanOneHarness('packages/host/src/loop.ts', body).length, body));
const accepted = (name, body) => test(`one harness accepts: ${name}`, () => assert.deepEqual(scanOneHarness('packages/host/src/loop.ts', body), [], body));

// Reference mutants: a pi-ai value or generation function reaches a generation read in the same file.
refused('member complete on a createModels() value with tools', `${PI} const models = createModels(); await models.complete(model, { messages, tools });`);
refused('bind alias of a Models stream', `${PI} const models = createModels(); const streamText = models.stream.bind(models); streamText(model, { messages, tools });`);
refused('imported complete function', 'import { complete } from "@earendil-works/pi-ai"; await complete(model, { messages, tools });');
refused('aliased imported stream function', 'import { stream as go } from "@earendil-works/pi-ai"; go(model, { messages, tools });');
refused('pi-ai namespace complete', 'import * as ai from "@earendil-works/pi-ai"; await ai.complete(model, { messages });');
refused('factory call through a namespace, then complete', 'import * as ai from "@earendil-works/pi-ai/models"; const models = ai.createModels(); await models.complete(model, { messages });');
refused('destructured stream from a Models value', `${PI} const models = createModels(); const { stream } = models; stream(model, { messages });`);
refused('dynamic pi-ai load, destructured factory, then complete', 'const { createModels } = await import("@earendil-works/pi-ai/models"); await createModels().complete(model, { messages });');
refused('Models-typed parameter', 'import type { Models } from "@earendil-works/pi-ai"; export async function run(models: Models, model) { return models.complete(model, { messages }); }');
refused('Models-typed property read through a local interface', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models: Models } export function run(options: Options, model) { return options.models.complete(model, { messages }); }');
refused('fallback between a Models-typed property and a default', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models?: Models } export function run(options: Options, fallback: Models, model) { const models = options.models ?? fallback; return models.complete(model, { messages }); }');

// Boundary mutants: the value leaves its file. Another file is then reached only through a reviewed file.
refused('Models value exported by name', `${PI} export const models = createModels();`);
refused('Models value exported through a function that returns it', `${PI} export function open() { const models = createModels(); return { models, ready: true }; }`);
refused('re-export of pi-ai complete', 'export { complete } from "@earendil-works/pi-ai";');
refused('re-export of the models factory', 'export { createModels } from "@earendil-works/pi-ai/models";');
refused('re-export of every pi-ai export', 'export * from "@earendil-works/pi-ai";');
refused('namespace re-export of pi-ai', 'export * as ai from "@earendil-works/pi-ai/models";');
refused('exported local alias of the factory', `${PI} const make = createModels; export { make };`);

test('one harness refuses a namespace re-export that another file uses to create and call a model (two files)', () => {
  const { findings } = analyzeOneHarness(new Map([
    ['packages/host/src/ai.ts', 'export * as ai from "@earendil-works/pi-ai/models";'],
    ['packages/host/src/loop.ts', 'import { ai } from "./ai.js"; const models = ai.createModels(); await models.complete(model, { messages, tools });'],
  ]));
  assert.ok(findings.get('packages/host/src/ai.ts').some((line) => line.includes('re-exports pi-ai namespace')), 'the boundary file is refused');
});
test('one harness refuses a Models value exported by one file, at the export', () => {
  const { findings } = analyzeOneHarness(new Map([
    ['packages/host/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/host/src/loop.ts', 'import { models } from "./models.js"; export const run = (model, tools) => models.complete(model, { messages: [], tools });'],
  ]));
  assert.ok(findings.get('packages/host/src/models.ts').some((line) => line.includes('exports a pi-ai value: models')));
});
test('one harness refuses a Models value exported across packages, at the export', () => {
  const { findings } = analyzeOneHarness(new Map([
    ['packages/agent/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/feedback/src/loop.ts', 'import { models } from "@hachej/boring-agent/models"; await models.complete(model, { messages, tools });'],
  ]));
  assert.ok(findings.get('packages/agent/src/models.ts').some((line) => line.includes('exports a pi-ai value: models')));
});

refused('factory alias, then call and complete', `${PI} const make = createModels; const models = make(); await models.complete(model, { messages });`);
refused('namespace factory alias, then call and complete', 'import * as ai from "@earendil-works/pi-ai/models"; const make = ai.createModels; const models = make(); await models.complete(model, { messages });');
refused('Models-typed member read through a type alias of a local interface', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models: Models } type Opts = Options; export function run(options: Opts, model) { const { models } = options; return models.complete(model, { messages }); }');

// Export forms beyond `export const` and `export {}`: default exports and local functions returning a pi-ai value.
refused('default export of an arrow that returns the factory result', `${PI} export default () => createModels();`);
refused('default export of a function that returns a Models value', `${PI} export default function () { const models = createModels(); return models; }`);
refused('named export of a local function that returns the factory result', `${PI} function open() { return createModels(); } export { open };`);
test('one harness refuses a local function returning a Models value, exported by name in another file (two files)', () => {
  const { findings } = analyzeOneHarness(new Map([
    ['packages/host/src/open.ts', `${PI} function open() { return createModels(); } export { open };`],
    ['packages/host/src/loop.ts', 'import { open } from "./open.js"; export const run = (model, tools) => open().complete(model, { messages: [], tools });'],
  ]));
  assert.ok(findings.get('packages/host/src/open.ts').some((line) => line.includes('exports a pi-ai value: open')), 'the export is refused');
});
test('one harness refuses a default-exported arrow that returns the factory result (two files)', () => {
  const { findings } = analyzeOneHarness(new Map([
    ['packages/host/src/open.ts', `${PI} export default () => createModels();`],
    ['packages/host/src/loop.ts', 'import open from "./open.js"; export const run = (model, tools) => open().complete(model, { messages: [], tools });'],
  ]));
  assert.ok(findings.get('packages/host/src/open.ts').some((line) => line.includes('exports a pi-ai value as default')), 'the default export diagnostic is reported');
});

// Acceptance: an unrelated receiver is flagged only when it is bound to pi-ai.
accepted('unrelated job.complete with tools next to pi-ai types', 'import { Type } from "@earendil-works/pi-ai"; export const x = Type.String(); export function run(job) { return job.complete({ tools: [x] }); }');
accepted('an unrelated same-property receiver with no pi import', 'export function run(job, model, tools) { return job.models.complete(model, { tools }); }');
accepted('a local complete function with tools', 'const complete = (model, options) => options; complete(model, { tools });');
accepted('a stream property on an unrelated object', 'import { Type } from "@earendil-works/pi-ai"; const response = fetchLike(); for await (const chunk of response.stream()) use(chunk);');
accepted('the native Harness owns the turn', 'import { Harness } from "@earendil-works/pi-durable"; await harness.submit(conversation, input);');
accepted('pi-ai types and tool declarations without a generation read', 'import { Type } from "@earendil-works/pi-ai"; export const tool = { name: "x", parameters: Type.Object({}) };');
accepted('a sibling member beside a Models-typed member is not a Models value', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models: Models; job: { complete(input: unknown): void } } export function run(options: Options) { return options.job.complete({ tools: [] }); }');
accepted('a destructured createModels from an unrelated object', 'const { createModels } = orm; const job = createModels(); job.complete({ tools: [] });');
accepted('a nested factory does not make its enclosing setup function a pi-ai value', `${PI} import { Harness } from "@earendil-works/pi-durable"; function setup(models) { function make() { return createModels(); } return Harness.open({ models: make() }); } export { setup };`);
accepted('comments and strings are not references', `${PI} // models.complete(model, { tools })\nconst text = "createModels().complete(model, { tools })";`);

test('the packages and examples of this repository have no pi-ai reference outside the reviewed allowlist', () => {
  const result = checkOneHarness(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 100);
  assert.deepEqual([...result.allowed].sort(), [
    'examples/bot/scripted-model.mjs', 'examples/feedback/builder.mjs', 'examples/feedback/model-preview.mjs', 'examples/feedback/server.mjs',
    'examples/redaction/scripted-model.mjs', 'examples/validated-output/scripted-model.mjs', 'packages/agent/src/memory/optchat.ts',
    'packages/browser/src/models.ts', 'packages/feedback/src/preview/agent.ts', 'packages/testing/src/model.ts',
  ]);
});
test('without the allowlist every reviewed site is reported', () => {
  const files = checkOneHarness(root, {}).errors.map((line) => line.split(':')[0].replace('ONE_HARNESS ', ''));
  for (const file of ['packages/feedback/src/preview/agent.ts', 'packages/agent/src/memory/optchat.ts', 'packages/browser/src/models.ts']) assert.ok(files.includes(file), file);
});
test('an allowlist entry that no longer matches a pi-ai reference is refused, so the allowlist cannot go stale', () => {
  const result = checkOneHarness(root, { 'packages/agent/src/conversations.ts': 'stale reason' });
  assert.ok(result.errors.some((line) => line.includes('no longer matches a pi-ai reference: packages/agent/src/conversations.ts')), result.errors.join('; '));
});
