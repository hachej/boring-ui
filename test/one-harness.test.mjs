import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzeOneHarness, checkOneHarness, scanOneHarness } from '../scripts/check-pi-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const PI = 'import { createModels } from "@earendil-works/pi-ai/models";';
const hand = (name, body) => test(`one harness refuses: ${name}`, () => assert.ok(scanOneHarness('packages/host/src/loop.ts', body)?.length, body));
const accepted = (name, body) => test(`one harness accepts: ${name}`, () => assert.deepEqual(scanOneHarness('packages/host/src/loop.ts', body), [], body));

// Same-file mutants: a pi-ai Models value, generation function or namespace reaches a generation read.
hand('member complete on a createModels() value with tools', `${PI} const models = createModels(); await models.complete(model, { messages, tools });`);
hand('bind alias of a Models stream', `${PI} const models = createModels(); const streamText = models.stream.bind(models); streamText(model, { messages, tools });`);
hand('imported complete function', 'import { complete } from "@earendil-works/pi-ai"; await complete(model, { messages, tools });');
hand('aliased imported stream function', 'import { stream as go } from "@earendil-works/pi-ai"; go(model, { messages, tools });');
hand('pi-ai namespace complete', 'import * as ai from "@earendil-works/pi-ai"; await ai.complete(model, { messages });');
hand('destructured stream from a Models value', `${PI} const models = createModels(); const { stream } = models; stream(model, { messages });`);
hand('dynamic pi-ai import member call', 'const { createModels } = await import("@earendil-works/pi-ai/models"); await createModels().complete(model, { messages });');
hand('Models-typed parameter', 'import type { Models } from "@earendil-works/pi-ai"; export async function run(models: Models, model) { return models.complete(model, { messages }); }');
hand('Models-typed property read through an interface', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models: Models } export function run(options: Options, model) { return options.models.complete(model, { messages }); }');
hand('fallback between a Models-typed property and a default', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models?: Models } export function run(options: Options, fallback: Models, model) { const models = options.models ?? fallback; return models.complete(model, { messages }); }');
hand('Models value exported by name', `${PI} export const models = createModels();`);
hand('re-export of pi-ai complete', 'export { complete } from "@earendil-works/pi-ai";');
hand('re-export of the models factory', 'export { createModels } from "@earendil-works/pi-ai/models";');
hand('re-export of every pi-ai export', 'export * from "@earendil-works/pi-ai";');

// Two-file mutants: a Models value crosses a module boundary, directly, through a re-export or through a dynamic import.
const twoFiles = (files) => analyzeOneHarness(new Map(files));
test('one harness refuses a Models value exported by one file and called with tools by another', () => {
  const { findings } = twoFiles([
    ['packages/host/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/host/src/loop.ts', 'import { models } from "./models.js"; export const run = (model, tools) => models.complete(model, { messages: [], tools });'],
  ]);
  assert.ok(findings.get('packages/host/src/models.ts').some((line) => line.includes('exports a Models value')));
  assert.ok(findings.get('packages/host/src/loop.ts').some((line) => line.includes('models.complete')));
});
test('one harness refuses a Models value re-exported through a second module', () => {
  const { findings } = twoFiles([
    ['packages/host/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/host/src/index.ts', 'export { models } from "./models.js";'],
    ['packages/host/src/loop.ts', 'import { models } from "./index.js"; models.stream(model, { messages, tools });'],
  ]);
  assert.ok(findings.get('packages/host/src/loop.ts').some((line) => line.includes('models.stream')));
});
test('one harness refuses a dynamic import that destructures a Models value', () => {
  const { findings } = twoFiles([
    ['packages/host/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/host/src/loop.ts', 'const { models } = await import("./models.js"); await models.complete(model, { messages, tools });'],
  ]);
  assert.ok(findings.get('packages/host/src/loop.ts').some((line) => line.includes('models.complete')));
});
test('one harness refuses a cross-package Models value read through the package name', () => {
  const { findings } = twoFiles([
    ['packages/agent/src/models.ts', `${PI} export const models = createModels();`],
    ['packages/feedback/src/loop.ts', 'import { models } from "@hachej/boring-agent/models"; await models.complete(model, { messages, tools });'],
  ]);
  assert.ok(findings.get('packages/feedback/src/loop.ts').some((line) => line.includes('models.complete')));
});

// Unrelated receivers and non-pi bindings pass: a call is flagged only when its receiver is bound to pi-ai.
accepted('unrelated job.complete with tools next to pi-ai types', 'import { Type } from "@earendil-works/pi-ai"; export const x = Type.String(); export function run(job) { return job.complete({ tools: [x] }); }');
accepted('a local complete function with tools', 'const complete = (model, options) => options; complete(model, { tools });');
accepted('a stream property on an unrelated object', 'import { Type } from "@earendil-works/pi-ai"; const response = fetchLike(); for await (const chunk of response.stream()) use(chunk);');
accepted('the native Harness owns the turn', 'import { Harness } from "@earendil-works/pi-durable"; await harness.submit(conversation, input);');
accepted('pi-ai types and tool declarations without a generation read', 'import { Type } from "@earendil-works/pi-ai"; export const tool = { name: "x", parameters: Type.Object({}) };');
accepted('comments and strings are not references', `${PI} // models.complete(model, { tools })\nconst text = "createModels().complete(model, { tools })";`);
accepted('an object with a Models-typed sibling does not make its other properties Models', 'import type { Models } from "@earendil-works/pi-ai"; interface Options { models: Models; name: string } export function run(options: Options) { return options.name.complete?.(); }');

test('the packages and examples of this repository have no pi-ai reference outside the reviewed allowlist', () => {
  const result = checkOneHarness(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 100);
  assert.deepEqual([...result.allowed].sort(), ['examples/feedback/model-preview.mjs', 'packages/agent/src/memory/optchat.ts', 'packages/browser/src/models.ts', 'packages/feedback/src/preview/agent.ts']);
});
test('without the allowlist every reviewed site is reported', () => {
  const files = checkOneHarness(root, {}).errors.map((line) => line.split(':')[0].replace('ONE_HARNESS ', ''));
  for (const file of ['packages/feedback/src/preview/agent.ts', 'packages/agent/src/memory/optchat.ts']) assert.ok(files.includes(file), file);
});
test('an allowlist entry that no longer matches a pi-ai reference is refused, so the allowlist cannot go stale', () => {
  const result = checkOneHarness(root, { 'packages/agent/src/conversations.ts': 'stale reason' });
  assert.ok(result.errors.some((line) => line.includes('no longer matches a pi-ai reference: packages/agent/src/conversations.ts')), result.errors.join('; '));
});
