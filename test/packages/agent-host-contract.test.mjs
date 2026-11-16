// @hachej/boring-agent/host: the app contract. defineApp and checkAgents refuse a malformed definition; `must` is the one rights rule.
// The two fixture apps are copies of the plugin proof's. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { CurrentUser, KIT_LANGUAGES, checkAgents, defineApp, must, mustOwn } from '@hachej/boring-agent/host';
import { defineAgent } from '@hachej/boring-agent/agents';
import { checkSource } from '../../scripts/pi-policy.mjs';
import notes from '../../fixtures/host-apps/notes/app.ts';
import todo from '../../fixtures/host-apps/todo/app.ts';
import { agents as notesAgents } from '../../fixtures/host-apps/notes/agents.ts';
import { agents as todoAgents } from '../../fixtures/host-apps/todo/agents.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
const words = { app: { title: 'Exemple' }, views: { v: 'Vue' }, refusals: {} };
const ok = { name: 'x1', languages: { base: 'fr', words: { fr: words } }, models: [], handlers: Layer.empty, api: {}, expose: { page: ['A'] }, views: [{ id: 'v', component: './v.tsx' }] };
const reader = { policy: {}, agent: 'r', key: () => '', message: () => '' };
const kit = { person: 'camille', model: { provider: 'faux', modelId: 'faux' }, tools: () => [], skills: () => ({}), ask: { name: 'ask' }, files: [] };

test('defineApp returns each fixture definition as the same object', () => {
  assert.equal(defineApp(notes), notes);
  assert.equal(defineApp(todo), todo);
  assert.deepEqual([...KIT_LANGUAGES], ['en', 'fr', 'de']);
});

const faults = {
  'no page operations': { ...ok, expose: { page: [] } },
  'unknown need': { ...ok, needs: ['gpu'] },
  'bad name': { ...ok, name: 'Bad Name' },
  'no view': { ...ok, views: [] },
  'reader with no expose list': { ...ok, agents: () => ({}), wakes: [reader] },
  'wake with no agents': { ...ok, wakes: [reader] },
  'two views with one id': { ...ok, views: [{ id: 'v', component: './a.tsx' }, { id: 'v', component: './b.tsx' }] },
  'needs mail': { ...ok, needs: ['mail'] },
  'no languages': { ...ok, languages: undefined },
  'base language not in the words': { ...ok, languages: { base: 'de', words: { fr: words } } },
  'base language the kit does not speak': { ...ok, languages: { base: 'xx', words: { xx: words } } },
  'words in a language the kit does not speak': { ...ok, languages: { base: 'fr', words: { fr: words, xx: words } } },
  'a view with no name in the base words': { ...ok, views: [{ id: 'other', component: './o.tsx' }] },
  'no title in the base words': { ...ok, languages: { base: 'fr', words: { fr: { ...words, app: {} } } } },
};

test('defineApp refuses each planted fault, naming the app and the field', () => {
  let missed = 0;
  for (const [fault, def] of Object.entries(faults)) {
    try { defineApp(def); console.log('NOT CAUGHT:', fault); missed++; } catch (e) {
      assert.match(e.message, /^defineApp\((x1|Bad Name)\): \S/);
      console.log('caught:', fault, '->', e.message);
    }
  }
  assert.equal(missed, 0);
  defineApp(ok);
});

test('checkAgents refuses what only the agents record shows', () => {
  const a = (id) => defineAgent({ id, model: kit.model, tools: [] });
  const cases = {
    'no assistant': [ok, { helper: a('helper') }],
    'expose key that is no audience nor agent': [{ ...ok, expose: { page: ['A'], ghost: ['A'] } }, { assistant: a('assistant') }],
    'wake of an unknown agent': [{ ...ok, wakes: [{ ...reader, agent: 'reader' }] }, { assistant: a('assistant') }],
    'record key differs from the agent id': [ok, { assistant: a('assistant'), other: a('another') }],
  };
  let missed = 0;
  for (const [fault, [def, record]] of Object.entries(cases)) {
    try { checkAgents(def, record); console.log('NOT CAUGHT:', fault); missed++; } catch (e) {
      assert.match(e.message, /^checkAgents\(x1\): \S/);
      console.log('caught:', fault, '->', e.message);
    }
  }
  assert.equal(missed, 0);
  checkAgents(notes, notesAgents(kit));
  checkAgents(todo, todoAgents(kit));
});

test('units.view must be one of expose.page', () => {
  const members = () => [];
  assert.throws(() => defineApp({ ...ok, units: { view: 'Notes.get', members } }), (e) => { console.log('units: view outside expose.page ->', e.message); return /^defineApp\(x1\): units\.view/.test(e.message); });
  defineApp({ ...ok, units: { view: 'A', members } });
  assert.equal(todo.units, undefined);
});

const members = [{ userId: 'camille', role: 'owner' }, { userId: 'dominique', role: 'editor' }, { userId: 'edgar', role: 'reader' }];
const check = (who, need, unit, op, list = members) => Effect.runPromise(Effect.result(must(need, unit, list, op).pipe(Effect.provideService(CurrentUser, who)))).then((r) => (r._tag === 'Success' ? 'ok' : r.failure._tag));
const scoped = (userId, unit, role, ops) => ({ userId, scope: { kind: 'unit', unit, role, ...(ops ? { ops } : {}) } });

test('must: twelve rows', async () => {
  const u1 = (who, op = 'AddNote') => check(who, 'editor', 'u1', op);
  const rows = [
    ['no scope, camille', await u1({ userId: 'camille' }), 'ok'],
    ['no scope, dominique', await u1({ userId: 'dominique' }), 'ok'],
    ['no scope, edgar', await u1({ userId: 'edgar' }), 'NotAllowed'],
    ['no scope, gaspard', await u1({ userId: 'gaspard' }), 'NotYours'],
    ['no scope, camille on u2', await check({ userId: 'camille' }, 'editor', 'u2', 'AddNote', [{ userId: 'dominique', role: 'editor' }]), 'NotYours'],
    ['no scope, dominique, AddContact', await u1({ userId: 'dominique' }, 'AddContact'), 'ok'],
    ['scope owner with ops', await u1(scoped('camille', 'u1', 'owner', ['AddNote'])), 'ok'],
    ['scope editor', await u1(scoped('camille', 'u1', 'editor')), 'ok'],
    ['scope reader', await u1(scoped('camille', 'u1', 'reader')), 'NotAllowed'],
    ['scope on u2, called on u1', await u1(scoped('camille', 'u2', 'owner')), 'NotYours'],
    ['scope ops Notes.get, called AddNote', await u1(scoped('camille', 'u1', 'owner', ['Notes.get'])), 'NotYours'],
    ['scope editor, gaspard', await u1(scoped('gaspard', 'u1', 'editor')), 'ok'],
  ];
  for (const [name, got, want] of rows) { console.log('must:', name, '->', got); assert.equal(got, want, name); }
  const own = (key, userId) => Effect.runPromise(Effect.result(mustOwn(key).pipe(Effect.provideService(CurrentUser, { userId })))).then((r) => (r._tag === 'Success' ? 'ok' : r.failure._tag));
  assert.equal(await own('camille', 'camille'), 'ok');
  assert.equal(await own({ id: 'camille' }, 'dominique'), 'NotYours');
});

test('the host source forbids targets, and the built entry reaches none', () => {
  for (const spec of ['cloudflare:workers', 'node:fs', 'alchemy']) {
    const errors = checkSource('packages/agent/src/host/x.ts', `import ${JSON.stringify(spec)};`, policy);
    assert.ok(errors.some((e) => e.includes('forbidden import in src/host/')), spec + ': ' + errors.join('; '));
  }
  assert.ok(!checkSource('packages/agent/src/host-cloudflare/x.ts', "import 'cloudflare:workers';", policy).some((e) => e.includes('src/host/')));
  const dist = join(root, 'packages/agent/dist');
  const seen = new Set(), external = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith('.')) { const next = join(dirname(file), spec); if (existsSync(next)) visit(next); } else external.add(spec);
    }
  };
  visit(join(dist, 'host.js'));
  const bad = [...external].filter((s) => s.startsWith('node:') || s.startsWith('cloudflare:') || s.startsWith('@earendil-works/pi-durable'));
  assert.deepEqual(bad, []);
  console.log('built host graph imports:', [...external].sort().join(', '));
});
