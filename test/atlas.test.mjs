import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAtlas, parseStep } from '../packages/ui/bin/boring-ui-blocks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const fixtures = join(root, 'test/fixtures/atlas');
const fixtureDir = join(fixtures, 'fixtures');
const schemaFile = join(root, 'packages/ui/atlas.schema.json');

// Every assertion goes through the real command: the bin is spawned, as an app's verify does.
const run = (dir, ...args) => spawnSync(process.execPath, [bin, 'atlas', join(fixtures, dir), ...args], { cwd: root, encoding: 'utf8' });
const findings = (dir, ...args) => { const r = run(dir, '--check', '--json', ...args); return { status: r.status, list: JSON.parse(r.stdout) }; };

test('a valid manifest (3+ states, a flow of 2 with after) has no finding and exits 0', () => {
  const r = run('valid', '--check', '--fixtures', fixtureDir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(findings('valid').list, []);
});

test('an unknown step verb is a finding at its step', () => {
  const { status, list } = findings('bad-verb');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].given.steps[0]']);
  assert.match(list[0].message, /hover/);
});

test('a duplicate id is a finding at the second state', () => {
  const { status, list } = findings('duplicate-id');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[1].id']);
  assert.match(list[0].message, /duplicate/);
});

test('a fixture file the app does not have is an error only with --fixtures', () => {
  assert.equal(findings('missing-fixture').status, 0);
  const { status, list } = findings('missing-fixture', '--fixtures', fixtureDir);
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[1].given.fixture', 'states[1].given.steps[0]']);
  assert.match(list[0].message, /inconnu/);
  assert.match(list[1].message, /absent/);
});

test('a fixture name without .synthetic. is refused', () => {
  const { status, list } = findings('non-synthetic');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].given.fixture']);
  assert.match(list[0].message, /synthetic/);
});

test('after without flow is a finding', () => {
  const { status, list } = findings('after-without-flow');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].after']);
});

test('unbalanced quotes and missing arguments are findings', () => {
  const { status, list } = findings('bad-quotes');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].given.steps[0]', 'states[0].given.steps[1]', 'states[0].given.steps[2]']);
  assert.match(list[0].message, /quote/);
});

test('a missing atlas.json exits 1 and names the file', () => {
  const r = run('no-manifest', '--check');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /atlas\.json/);
});

test('without --check the command does not fake shooting', () => {
  const r = run('valid');
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /next slice/);
});

test('a directory named like a fixture is not a fixture file', () => {
  const { status, list } = findings('dir-fixture', '--fixtures', join(fixtures, 'dir-fixture/fixtures'));
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].given.fixture']);
});

test('relative and absolute <dir> and --fixtures both work', () => {
  const rel = spawnSync(process.execPath, [bin, 'atlas', 'test/fixtures/atlas/valid', '--check', '--fixtures', 'test/fixtures/atlas/fixtures'], { cwd: root, encoding: 'utf8' });
  assert.equal(rel.status, 0, rel.stdout + rel.stderr);
  const abs = spawnSync(process.execPath, [bin, 'atlas', join(fixtures, 'valid'), '--check', '--fixtures', fixtureDir], { cwd: fixtures, encoding: 'utf8' });
  assert.equal(abs.status, 0, abs.stdout + abs.stderr);
});

// Same token and quote semantics as boring-factory templates/app/test/examples-core.ts (parseStep, token, phrase): " ' « » “ ” quote a
// phrase, which is trimmed; a step with trailing text after the quoted phrase keeps the whole text as one phrase.
test('parseStep follows the Factory examples grammar', () => {
  assert.deepEqual(parseStep('click « Se connecter »'), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep("click 'Se connecter'"), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep('click “Se connecter”'), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep('click "A" suite'), { verb: 'click', args: ['"A" suite'] });
  assert.deepEqual(parseStep('fill « Mot de passe » « un faux »'), { verb: 'fill', args: ['Mot de passe', 'un faux'] });
  assert.deepEqual(parseStep('fill Courriel jeanne et marie'), { verb: 'fill', args: ['Courriel', 'jeanne et marie'] });
  assert.deepEqual(parseStep('upload « a.synthetic.csv »'), { verb: 'upload', args: ['a.synthetic.csv'] });
});

test('parseStep reads bare, double-quoted and guillemet arguments', () => {
  assert.deepEqual(parseStep('open Écritures'), { verb: 'open', args: ['Écritures'] });
  assert.deepEqual(parseStep('click Se connecter'), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep('click « Se connecter »'), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep('fill "Mot de passe" "faux"'), { verb: 'fill', args: ['Mot de passe', 'faux'] });
  assert.deepEqual(parseStep('fill Courriel jeanne@example.test'), { verb: 'fill', args: ['Courriel', 'jeanne@example.test'] });
  assert.deepEqual(parseStep('upload'), { verb: 'upload', args: [] });
  assert.deepEqual(parseStep('upload a.synthetic.csv'), { verb: 'upload', args: ['a.synthetic.csv'] });
  assert.ok(parseStep('fill Courriel').error);
  assert.ok(parseStep('drop a.csv').error);
});

// A tiny evaluator of the schema keywords the file uses (type string, minLength, pattern), so the two are compared on behaviour.
const schemaAccepts = (prop, value) => typeof value === 'string' && value.length >= (prop.minLength ?? 0) && (!prop.pattern || new RegExp(prop.pattern).test(value));

test('the schema and the validator accept and refuse the same values', () => {
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
  const state = schema.$defs.state.properties, given = schema.$defs.given.properties;
  const base = { id: 'a.b', page: '/a', title: 'A', given: { fixture: 'a.synthetic.csv' }, flow: 'f' };
  const accepted = (mutate) => checkAtlas({ states: [mutate(structuredClone(base))] }).length === 0;
  const samples = {
    title: ['A', '', ' ', '  \t'],
    flow: ['f', '', ' '],
    after: ['Mauvais mot de passe', '', '   '],
    page: ['/a', 'a', '', '/'],
    id: ['a.b', 'A', 'a b', 'a..b', '-a', 'a-b.c9', ''],
  };
  for (const [key, values] of Object.entries(samples)) {
    for (const value of values) assert.equal(accepted(s => { s[key] = value; return s; }), schemaAccepts(state[key], value), `${key} ${JSON.stringify(value)}`);
  }
  for (const value of ['a.synthetic.csv', 'a.csv', 'a.SYNTHETIC.csv', 'dir/a.synthetic.csv', 'a b.synthetic.csv', '.synthetic.', 'x.synthetic.y'])
    assert.equal(accepted(s => { s.given.fixture = value; return s; }), schemaAccepts(given.fixture, value), `fixture ${value}`);
  // Steps whose arity the schema can state (fill needs two arguments: the validator alone refuses `fill a`).
  for (const step of ['open x', 'open  x', 'open', 'open ', 'upload', 'upload ', 'upload x.synthetic.csv', 'uploadx', 'click x', 'click', 'click  ', 'wait x', 'wait', 'hover x', 'drop x', 'fill a b', ' click x'])
    assert.equal(accepted(s => { s.given.steps = [step]; return s; }), schemaAccepts(given.steps.items, step), `step ${JSON.stringify(step)}`);
  // The schema cannot say "synthetic" for a step's argument; the validator does, as Factory's row check does for every named fixture.
  assert.deepEqual(checkAtlas({ states: [{ ...base, given: { fixture: 'a.synthetic.csv', steps: ['upload clients.csv'] } }] }).map(f => f.path), ['states[0].given.steps[0]']);
  const { flow: _, ...noFlow } = { ...base, after: 'x' };
  assert.deepEqual(checkAtlas({ states: [noFlow] }).map(f => f.path), ['states[0].after']);
});

test('the package name is the published one', () => {
  const name = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8')).name;
  assert.equal(name, '@hachej/boring-ui-kit');
  const schema = readFileSync(schemaFile, 'utf8');
  const docs = readFileSync(join(root, 'features/atlas.md'), 'utf8') + readFileSync(join(root, 'MIGRATING.md'), 'utf8').split('# Migrating to')[0];
  assert.ok(schema.includes(`${name}/atlas.schema.json`));
  assert.ok(docs.includes(`${name}/atlas.schema.json`));
  assert.ok(!/@hachej\/boring-ui\/atlas/.test(schema + docs));
});

test('the schema and the hand validator agree', () => {
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
  const state = schema.$defs.state, given = schema.$defs.given;
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(state.additionalProperties, false);
  assert.equal(given.additionalProperties, false);
  assert.deepEqual([...state.required].sort(), ['given', 'id', 'page', 'title']);
  assert.deepEqual(Object.keys(state.properties).sort(), ['after', 'flow', 'given', 'id', 'page', 'title']);
  assert.deepEqual([...given.required], ['fixture']);
  const verbs = new RegExp(given.properties.steps.items.pattern);
  for (const step of ['open x', 'upload', 'upload x', 'click x', 'fill x y', 'wait x']) assert.ok(verbs.test(step), step);
  for (const step of ['hover x', 'drop x']) assert.ok(!verbs.test(step), step);
  const synthetic = new RegExp(given.properties.fixture.pattern);
  assert.ok(synthetic.test('a.synthetic.csv') && !synthetic.test('a.csv'));
  const ok = { id: 'a.b', page: '/a', title: 'A', given: { fixture: 'a.synthetic.csv' } };
  assert.deepEqual(checkAtlas({ states: [ok] }), []);
  // Each required key, when removed, is a finding of the validator.
  for (const key of state.required) {
    const { [key]: _, ...rest } = ok;
    assert.equal(checkAtlas({ states: [rest] }).length, 1, `missing ${key}`);
  }
  assert.equal(checkAtlas({ states: [{ ...ok, given: {} }] }).length, 1);
  // Extra keys at both levels and a bad id or page are findings, as the schema says.
  assert.equal(checkAtlas({ states: [{ ...ok, extra: 1 }] }).length, 1);
  assert.equal(checkAtlas({ states: [{ ...ok, given: { ...ok.given, extra: 1 } }] }).length, 1);
  assert.equal(checkAtlas({ states: [{ ...ok, fixture: 'x' }] }).length, 1);
  assert.equal(checkAtlas({ states: [{ ...ok, id: 'A b' }] }).length, 1);
  assert.ok(new RegExp(state.properties.id.pattern).test('ecritures.empty'));
  assert.ok(!new RegExp(state.properties.id.pattern).test('A b'));
  assert.ok(new RegExp(state.properties.page.pattern).test('/a') && !new RegExp(state.properties.page.pattern).test('a'));
});
