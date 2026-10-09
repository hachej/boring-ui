// Standalone feasibility probe, not a Boring composer, catalog or renderer.
// Pass an isolated directory containing @json-render/core@0.21.0, @json-render/react@0.21.0 and zod@4.6.5.
// Uses a deterministic in-process evaluator and invented values; makes no network or model request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

assert.ok(process.argv[2], 'usage: node scripts/probe-json-render.mjs <isolated-dependency-directory>');
globalThis.fetch = () => { throw new Error('network denied in json-render probe'); };
const require = createRequire(resolve(process.argv[2], 'package.json'));
const { defineCatalog, experimental_composeSpec: composeSpec } = require('@json-render/core');
const { schema } = require('@json-render/react/schema');
const { z } = require('zod');
import { readFileSync } from 'node:fs';
const versions = ['@json-render/core', '@json-render/react', 'zod'].map((name) => `${name}@${JSON.parse(readFileSync(resolve(process.argv[2], 'node_modules', name, 'package.json'), 'utf8')).version}`);

const catalog = defineCatalog(schema, {
  components: {
    Stack: { props: z.object({}).strict(), slots: ['default'], description: 'Vertical stack.' },
    Card: { props: z.object({ title: z.string(), body: z.string().optional() }).strict(), slots: [], description: 'A card.' },
    Button: { props: z.object({ label: z.string() }).strict(), slots: [], events: ['press'], description: 'A button.' },
  },
  actions: { start: { params: z.object({ task: z.string() }).strict(), description: 'Named host action.' } },
});

// Invented values standing in for content an application must not send to an evaluator.
const SENTINEL = { literal: 'SENTINEL-LITERAL-7f3a', state: 'SENTINEL-STATE-91c2', path: 'sentinelpath4d1e', param: 'SENTINEL-PARAM-b8e0' };
const requests = [];
const firstOffered = async (request) => {
  requests.push(JSON.parse(JSON.stringify({ state: request.state, questions: request.questions })));
  const answers = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const keys = Object.keys(question.criteria);
    answers[name] = { choice: name === 'root' ? keys[0] : keys.find((key) => key.startsWith('use:')) ?? keys.at(-1) };
  }
  return { answers };
};
const candidates = [
  { id: 'stack', description: 'Layout container', element: { type: 'Stack', props: {} }, maxUses: 2 },
  { id: 'summary', description: 'Summary card', root: false, element: { type: 'Card', props: { title: SENTINEL.literal, body: { $state: `/${SENTINEL.path}/body` } } } },
  { id: 'begin', description: 'Start button', root: false, element: { type: 'Button', props: { label: 'Start' }, on: { press: { action: 'start', params: { task: SENTINEL.param } } } } },
];
const initialState = { [SENTINEL.path]: { body: SENTINEL.state } };
const events = [];
for await (const event of composeSpec({ catalog, candidates, prompt: 'show the summary', evaluate: firstOffered, initialState })) events.push(event);
const sent = JSON.stringify(requests);
for (const [kind, value] of Object.entries(SENTINEL)) assert.ok(!sent.includes(value), `${kind} value reached the evaluator`);
assert.ok(sent.includes('Summary card'), 'candidate descriptions are sent');
const final = events.at(-1);
assert.equal(final.type, 'complete');
assert.ok(events.some((event) => event.type === 'step'), 'at least one partial snapshot before completion');
assert.equal(final.spec.state[SENTINEL.path].body, SENTINEL.state, 'initialState is copied into the returned spec');
console.log(`PASS: ${versions.join(', ')}; ${requests.length} evaluator request(s) carried descriptions only: no literal prop, state value, binding path or action parameter.`);
console.log('PASS: the composed spec embeds initialState: a spec carrying values must be bound after composition, not composed with them.');

// The spec schema's validate checks structure and type names, not each element's props against its component schema.
const loose = { root: 'a', elements: { a: { type: 'Card', props: { title: 1, injected: 'x' }, children: [] } } };
assert.equal(catalog.validate(loose).success, true);
assert.equal(catalog.validate({ root: 'a', elements: { a: { type: 'Unknown', props: {}, children: [] } } }).success, false);
console.log('PASS: catalog.validate refuses an unknown type but accepts props that violate the strict component schema; a host must validate props per element.');

// Candidates are validated before any evaluation.
const refused = async (list) => { try { for await (const _ of composeSpec({ catalog, candidates: list, prompt: 'x', evaluate: firstOffered })); return null; } catch (error) { return error.message; } };
assert.match(await refused([{ id: 'x', description: 'x', element: { type: 'Unknown', props: {} } }]), /Unknown candidate component/);
assert.match(await refused([{ id: 'x', description: 'x', element: { type: 'Card', props: { title: 2 } } }]), /Invalid props/);
assert.match(await refused([{ id: 'x', description: 'x', element: { type: 'Card', props: { title: 't' }, on: { press: { action: 'arbitrary' } } } }]), /Unknown event|Unknown catalog action/);
const outside = async () => ({ answers: { root: { choice: 'not-offered' } } });
let outsideError = null;
try { for await (const _ of composeSpec({ catalog, candidates, prompt: 'x', evaluate: outside })); } catch (error) { outsideError = error.message; }
assert.match(outsideError, /outside the permitted/);
console.log('PASS: unknown candidate types, invalid candidate props, unbound actions and evaluator choices outside the offered criteria are refused.');
console.log('Scope: one pinned package build with an in-process evaluator; not Jev quality, Gateway transport, latency, a Boring catalog or a renderer.');
