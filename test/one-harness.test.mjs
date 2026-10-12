import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkOneHarness, scanOneHarness } from '../scripts/check-pi-boundary.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hand = (body) => assert.ok(scanOneHarness('packages/host/src/loop.ts', body).length, body);
const accepted = (body) => assert.deepEqual(scanOneHarness('packages/host/src/loop.ts', body), [], body);

// BORING-PI-1 one harness, structural: a host never drives the model with its own tool loop. Each mutant is a hand-rolled loop.
for (const [name, body] of [
  ['member complete with tools and a tool-call reader', 'import { createModels } from "@earendil-works/pi-ai/models"; const m = createModels(); for (;;) { const r = await m.complete(model, { messages, tools }); r.content.filter(p => p.type === "toolCall").forEach(run); }'],
  ['member stream with tools', 'import { createModels } from "@earendil-works/pi-ai/models"; m.stream(model, { messages, tools: [t] });'],
  ['member streamSimple with validation', 'import { createModels } from "@earendil-works/pi-ai/models"; const r = await m.streamSimple(model, { messages, tools }); validateToolCall(tools, call);'],
  ['imported complete with tools', 'import { complete } from "@earendil-works/pi-ai"; await complete(model, { messages, tools });'],
  ['aliased imported stream with a tool-call reader', 'import { stream as go } from "@earendil-works/pi-ai"; const s = go(model, { messages, tools }); for (const c of s) if (c.type === "toolCall") run(c);'],
  ['tool-call validation next to a tool-carrying model call', 'import { Type, validateToolCall } from "@earendil-works/pi-ai"; const m = pick(); await m.complete(model, { messages, tools: [Type.Object({})] });'],
  ['dynamic pi-ai import with tools', 'const { createModels } = await import("@earendil-works/pi-ai/models"); await createModels().complete(model, { messages, tools });'],
]) test(`one harness refuses a hand-rolled tool loop: ${name}`, () => hand(body));

for (const [name, body] of [
  ['a summarizer that makes a plain model call with no tools', 'import { createModels } from "@earendil-works/pi-ai/models"; const reply = await models.complete(model, { systemPrompt, messages }, { signal });'],
  ['the native Harness owns the turn', 'import { Harness } from "@earendil-works/pi-durable"; await harness.submit(conversation, input);'],
  ['a local complete function with tools and no pi-ai import', 'const complete = (model, options) => options; complete(model, { tools });'],
  ['pi-ai types and a tool declaration without a model call', 'import { Type } from "@earendil-works/pi-ai"; export const tool = { name: "x", parameters: Type.Object({}) };'],
  ['comments and strings do not become calls', 'import { createModels } from "@earendil-works/pi-ai/models"; // models.complete(model, { tools })\nconst text = "complete(model, { tools })";'],
]) test(`one harness accepts: ${name}`, () => accepted(body));

test('the packages and examples of this repository have no hand-rolled loop outside the reviewed allowlist', () => {
  const result = checkOneHarness(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 100);
  assert.deepEqual(result.allowed, ['packages/feedback/src/preview/agent.ts']);
});

test('without the allowlist the reviewed site is the only hand-rolled loop found', () => {
  const result = checkOneHarness(root, {});
  assert.deepEqual(result.errors.map((line) => line.split(':')[0].replace('ONE_HARNESS ', '')), ['packages/feedback/src/preview/agent.ts']);
});

test('an allowlist entry that no longer matches a loop is refused, so the allowlist cannot go stale', () => {
  const result = checkOneHarness(root, { 'packages/agent/src/conversations.ts': 'stale reason' });
  assert.ok(result.errors.some((line) => line.includes('no longer matches a hand-rolled loop: packages/agent/src/conversations.ts')), result.errors.join('; '));
});
