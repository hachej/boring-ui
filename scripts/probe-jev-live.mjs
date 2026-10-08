// Live feasibility probe (acceptance journey A31, real-model level), not a Boring composer or evaluator.
// Pass an isolated directory containing @json-render/core@0.21.0, @json-render/react@0.21.0 and zod@4.6.5.
// Needs TYPESAFE_API_KEY (never printed); TYPESAFE_ENDPOINT and TYPESAFE_MODEL default to the documented values.
// Every candidate, value and fixture is invented. Network is limited to the TypeSafe endpoint; every request body
// is captured, checked for sentinel values and written with its values redacted.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const [dir, out = '.cache/evidence/jev-live', runsArg = '3'] = process.argv.slice(2);
assert.ok(dir, 'usage: node scripts/probe-jev-live.mjs <isolated-dependency-directory> [evidence-dir] [runs]');
const key = process.env.TYPESAFE_API_KEY?.trim();
assert.ok(key, 'TYPESAFE_API_KEY is required');
const endpoint = process.env.TYPESAFE_ENDPOINT || 'https://api.typesafe.ai/v1/systemone';
const model = process.env.TYPESAFE_MODEL || 'jev-latest';
const RUNS = Number(runsArg);
const require = createRequire(resolve(dir, 'package.json'));
const { defineCatalog, experimental_composeSpec: composeSpec, experimental_createEvaluator: createEvaluator } = require('@json-render/core');
const { schema } = require('@json-render/react/schema');
const { z } = require('zod');
const version = (name) => JSON.parse(readFileSync(resolve(dir, 'node_modules', name, 'package.json'), 'utf8')).version;
mkdirSync(out, { recursive: true });

// Network: only the TypeSafe endpoint; every body is captured before it leaves.
const wire = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  assert.equal(String(url), endpoint, `network denied: ${url}`);
  wire.push(String(init.body ?? ''));
  return realFetch(url, init);
};

// The host's catalog (real props) and the composition catalog (an opaque marker instead of props).
const items = z.array(z.object({ id: z.string(), label: z.string(), done: z.boolean() }).strict());
const kinds = {
  Stack: { props: z.object({ gap: z.enum(['sm', 'md', 'lg']).optional() }).strict(), slots: ['default'], description: 'Vertical stack.' },
  Columns: { props: z.object({ columns: z.number().int().min(1).max(4).optional() }).strict(), slots: ['default'], description: 'Side by side.' },
  Section: { props: z.object({ title: z.string() }).strict(), slots: ['default'], description: 'Titled group.' },
  Timeline: { props: z.object({ title: z.string().optional(), events: z.array(z.object({ at: z.string(), label: z.string() }).strict()) }).strict(), slots: [], description: 'Events in time order.' },
  Checklist: { props: z.object({ title: z.string().optional(), items }).strict(), slots: [], events: ['change'], description: 'Items to tick.' },
  Card: { props: z.object({ title: z.string(), body: z.string().optional() }).strict(), slots: [], events: ['press'], description: 'A card.' },
  Metric: { props: z.object({ label: z.string(), value: z.union([z.string(), z.number()]) }).strict(), slots: [], description: 'One number.' },
};
const hostCatalog = defineCatalog(schema, { components: kinds, actions: { send: { params: z.object({ draft: z.string() }).strict(), description: 'Admitted host action.' } } });
const marker = z.object({ cell: z.string() }).strict();
const composeCatalog = defineCatalog(schema, { components: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, { ...v, props: marker, events: undefined }])) });

// Strip: a full cell (props with bindings, values, actions) becomes metadata plus an opaque marker.
const strip = (cell) => ({ id: cell.id, description: cell.description, ...(cell.root === false ? { root: false } : {}), ...(cell.maxUses ? { maxUses: cell.maxUses } : {}), element: { type: cell.element.type, props: { cell: cell.id } } });
const rebind = (spec, cells) => {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const elements = Object.fromEntries(Object.entries(spec.elements).map(([id, el]) => {
    const cell = byId.get(el.props.cell);
    assert.ok(cell, `unknown marker ${el.props.cell}`);
    return [id, { ...structuredClone(cell.element), children: el.children ?? [] }];
  }));
  return { root: spec.root, elements };
};
const resolveState = (value, state) => {
  if (Array.isArray(value)) return value.map((v) => resolveState(v, state));
  if (value && typeof value === 'object') {
    if (typeof value.$state === 'string') return value.$state.split('/').slice(1).reduce((o, k) => o?.[k], state);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveState(v, state)]));
  }
  return value;
};
// Host validation: catalog structure, then every element's props (bindings resolved) against its kind's strict schema.
function hostValidate(spec, state, allowed) {
  const problems = [];
  if (!hostCatalog.validate(spec).success) problems.push('catalog structure');
  for (const [id, el] of Object.entries(spec.elements)) {
    const kind = kinds[el.type];
    if (!kind) { problems.push(`${id}: unknown kind ${el.type}`); continue; }
    if (!kind.props.safeParse(resolveState(el.props, state)).success) problems.push(`${id}: props invalid for ${el.type}`);
  }
  for (const cell of spec.cells) if (!allowed.has(cell)) problems.push(`${cell}: not an allowed cell`);
  return problems;
}
const redact = (value, path = []) => {
  if (Array.isArray(value)) return value.map((v, i) => redact(v, [...path, i]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, [...path, k])]));
  if (typeof value === 'string') return path.at(-1) === 'model' || path.at(-1) === 'type' ? value : `<string:${value.length}>`;
  return value;
};

const S = { body: 'SENTINEL-BODY-5c1e', sender: 'SENTINEL-SENDER-0a7d', path: 'sentinelpath9b2f', param: 'SENTINEL-PARAM-e44c', cond: 'SENTINEL-CONDITION-31aa' };
const layout = [
  { id: 'stack', description: 'Layout: vertical stack', maxUses: 3, element: { type: 'Stack', props: {} } },
  { id: 'columns', description: 'Layout: two columns side by side', maxUses: 2, root: false, element: { type: 'Columns', props: { columns: 2 } } },
];
const card = (id, description, binding) => ({ id, description, root: false, element: { type: 'Card', props: { title: { $state: `/${S.path}/${binding}/title` }, body: { $state: `/${S.path}/${binding}/body` } }, on: { press: { action: 'send', params: { draft: S.param } } } } });
const scenarios = {
  morning: {
    prompt: 'Start my day: what needs me today. Urgent replies and the calendar conflict first, the day and my todo visible, leave out low-priority mail.',
    cells: [
      ...layout,
      { id: 'day-timeline', description: 'Day timeline: 6 events today, 1 conflict, 1 travel', root: false, element: { type: 'Timeline', props: { title: 'Today', events: { $state: `/${S.path}/timeline` } } } },
      { id: 'todo', description: 'Todo for today: 7 items, 3 time-bound', root: false, element: { type: 'Checklist', props: { title: 'Todo', items: { $state: `/${S.path}/todo` } } } },
      card('mail-urgent-1', 'Mail needs reply: time-bound today, blocking someone, draft reply ready', 'm1'),
      card('mail-urgent-2', 'Mail needs reply: needs a decision, time-bound this week, draft reply ready', 'm2'),
      card('mail-low', 'Mail needs reply: low priority', 'm3'),
      card('waiting-on', 'Waiting on others: 2 threads, none overdue', 'w'),
      card('fyi', 'FYI digest: 9 messages, low priority', 'f'),
      card('conflict', 'Calendar conflict: two events overlap at one slot, needs decision, 2 options', 'c'),
      card('travel', 'Travel event today: preparation needed', 't'),
      { id: 'unread', description: 'Count of unread mail', root: false, element: { type: 'Metric', props: { label: 'Unread', value: { $state: `/${S.path}/unread` } } } },
    ],
  },
  clinic: {
    prompt: "Clinical cards region for today's consultation: acute and decision-today first, then above-target, then follow-up and questions; up-to-date problems last or left out.",
    cells: [
      ...layout,
      card('problem-a', 'Problem card: acute, decision today', 'pa'),
      card('problem-b', 'Problem card: chronic, above target', 'pb'),
      card('problem-c', 'Problem card: chronic, up to date', 'pc'),
      card('problem-d', 'Problem card: chronic, up to date', 'pd'),
      card('risk', 'Risk factor card: above target', 'r'),
      card('followup', 'Follow-up card: one check overdue', 'fu'),
      card('question', 'Question card: to explore today', 'q'),
    ],
  },
};
// Invented values, bound only after composition.
const state = { [S.path]: { timeline: [{ at: '09:00', label: S.body }], todo: [{ id: 't1', label: S.body, done: false }], unread: 12,
  ...Object.fromEntries(['m1', 'm2', 'm3', 'w', 'f', 'c', 't', 'pa', 'pb', 'pc', 'pd', 'r', 'fu', 'q'].map((k) => [k, { title: `${S.sender} ${k}`, body: `${S.body} ${S.cond}` }])) } };

// The evaluator adapter (CONTRACTS.md evaluator interface): json-render's { state, questions } plus the model.
const resolvedModels = new Set();
const typesafeEvaluator = ({ timeoutMs = 30_000 } = {}) => async ({ state: evalState, questions, signal }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('evaluation timed out')), timeoutMs);
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: evalState, questions, model }), signal: controller.signal });
    if (!response.ok) throw new Error(`evaluation HTTP ${response.status}`);
    const body = await response.json();
    if (body.model) resolvedModels.add(body.model);
    const answers = Object.fromEntries(Object.keys(questions).map((q) => {
      const a = body.answers?.[q];
      if (!a || a.type !== 'choice' || typeof a.choice !== 'string') throw new Error(`no choice answer for ${q}`);
      return [q, { choice: a.choice, ...(Number.isFinite(a.confidence) ? { confidence: a.confidence } : {}) }];
    }));
    return { answers, usage: { inputTokens: body.usage?.input_tokens }, model: body.model };
  } finally { clearTimeout(timer); }
};

const order = (spec) => { const seq = []; const walk = (id, depth) => { const el = spec.elements[id]; seq.push(`${'  '.repeat(depth)}${el.type}${el.props.cell ? `:${el.props.cell}` : ''}`); for (const c of el.children ?? []) walk(c, depth + 1); }; walk(spec.root, 0); return seq; };
const results = [];
for (const [name, scenario] of Object.entries(scenarios)) {
  const candidates = scenario.cells.map(strip);
  const allowed = new Set(scenario.cells.map((c) => c.id));
  for (let run = 1; run <= RUNS; run++) {
    const sentBefore = wire.length;
    const started = performance.now();
    const steps = [];
    let final = null, error = null;
    try {
      for await (const event of composeSpec({ catalog: composeCatalog, candidates, prompt: scenario.prompt, evaluate: typesafeEvaluator(), maxElements: 16, signal: AbortSignal.timeout(90_000) })) {
        if (event.type === 'step') steps.push({ choice: event.step.choice, elapsedMs: event.step.elapsedMs, inputTokens: event.step.inputTokens, elements: Object.keys(event.spec.elements).length });
        else final = event;
      }
    } catch (e) { error = e.message; }
    const elapsedMs = Math.round(performance.now() - started);
    const bodies = wire.slice(sentBefore);
    for (const body of bodies) for (const [k, v] of Object.entries(S)) assert.ok(!body.includes(v), `${k} sentinel left the machine`);
    let bound = null, problems = ['no spec'], chosen = [];
    if (final?.spec) {
      chosen = order(final.spec);
      bound = rebind(final.spec, scenario.cells);
      bound.cells = Object.values(final.spec.elements).map((e) => e.props.cell);
      problems = hostValidate(bound, state, allowed);
    }
    const row = { scenario: name, run, elapsedMs, stopReason: final?.stopReason ?? null, error, evaluations: bodies.length, steps, inputTokens: final?.inputTokens ?? null, valid: problems.length === 0, problems, chosen };
    results.push(row);
    console.log(`${name} #${run}: ${error ? `ERROR ${error}` : `${final.stopReason}, ${elapsedMs} ms, ${bodies.length} evaluation(s), ${row.valid ? 'valid' : `INVALID ${problems.join('; ')}`}`}`);
    for (const line of chosen) console.log(`    ${line}`);
    if (run === 1) writeFileSync(resolve(out, `${name}-request-shape.json`), `${JSON.stringify(bodies.map((b) => redact(JSON.parse(b))), null, 2)}\n`);
  }
}

// The packaged evaluator can reach the same endpoint through its fetch option (the Gateway URL is fixed in 0.21.0).
let packaged = null;
try {
  const viaFetch = (url, init) => fetch(endpoint, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...JSON.parse(init.body), model }) });
  const evaluate = createEvaluator({ apiKey: key, model, fetch: viaFetch, timeoutMs: 30_000 });
  const t = performance.now();
  let last;
  for await (const e of composeSpec({ catalog: composeCatalog, candidates: scenarios.morning.cells.map(strip), prompt: scenarios.morning.prompt, evaluate })) last = e;
  packaged = { ok: true, stopReason: last.stopReason, elapsedMs: Math.round(performance.now() - t) };
} catch (e) { packaged = { ok: false, error: e.message }; }
console.log(`experimental_createEvaluator with a fetch shim to ${new URL(endpoint).host}: ${packaged.ok ? `${packaged.stopReason}, ${packaged.elapsedMs} ms` : `failed: ${packaged.error}`}`);

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const summary = {};
for (const name of Object.keys(scenarios)) {
  const rows = results.filter((r) => r.scenario === name && !r.error);
  const evals = rows.flatMap((r) => r.steps.map((s) => s.elapsedMs));
  summary[name] = { runs: results.filter((r) => r.scenario === name).length, completed: rows.length, valid: rows.filter((r) => r.valid).length,
    compositionP50: pct(rows.map((r) => r.elapsedMs), 0.5), compositionMax: Math.max(...rows.map((r) => r.elapsedMs)),
    evaluationP50: pct(evals, 0.5), evaluationMax: Math.max(...evals), identicalLayouts: new Set(rows.map((r) => r.chosen.join('|'))).size === 1 };
}
console.log(`model ${model} resolved to ${[...resolvedModels].join(', ') || 'unreported'}`);
console.log(JSON.stringify(summary));
writeFileSync(resolve(out, 'results.json'), `${JSON.stringify({ versions: { core: version('@json-render/core'), react: version('@json-render/react'), zod: version('zod') }, endpoint, model, resolvedModels: [...resolvedModels], results, packaged, summary }, null, 2)}\n`);
console.log(`PASS: ${wire.length} request bodies captured; no sentinel (props, bound values, binding paths, action parameters) left the machine.`);
console.log('Scope: invented metadata-only candidates against the live endpoint; not a Boring renderer, host admission or clinical judgment.');
