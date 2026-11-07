import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAtlas, parseStep } from '../packages/ui/bin/atlas.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const fixtures = join(root, 'test/fixtures/atlas');
const schemaFile = join(root, 'packages/ui/atlas.schema.json');

// Every assertion goes through the real command: the bin is spawned, as an app's verify does.
const run = (dir, ...args) => spawnSync(process.execPath, [bin, 'atlas', join(fixtures, dir), ...args], { cwd: root, encoding: 'utf8' });
const findings = (dir, ...args) => { const r = run(dir, '--check', '--json', ...args); return { status: r.status, list: JSON.parse(r.stdout) }; };

test('a valid manifest has no finding and exits 0', () => {
  const r = run('valid', '--check', '--fixtures', join(fixtures, 'fixtures.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(findings('valid').list, []);
});

test('an unknown step verb is a finding at its step', () => {
  const { status, list } = findings('bad-verb');
  assert.equal(status, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].path, 'states[0].steps[0]');
  assert.match(list[0].message, /hover/);
});

test('a duplicate id is a finding at the second state', () => {
  const { status, list } = findings('duplicate-id');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[1].id']);
  assert.match(list[0].message, /duplicate/);
});

test('a fixture the app does not know is an error only with --fixtures', () => {
  assert.equal(findings('missing-fixture').status, 0);
  const { status, list } = findings('missing-fixture', '--fixtures', join(fixtures, 'fixtures.json'));
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[1].fixture']);
  assert.match(list[0].message, /inconnu/);
});

test('after without flow is a finding', () => {
  const { status, list } = findings('after-without-flow');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].after']);
});

test('unbalanced quotes and missing arguments are findings', () => {
  const { status, list } = findings('bad-quotes');
  assert.equal(status, 1);
  assert.deepEqual(list.map(f => f.path), ['states[0].steps[0]', 'states[0].steps[1]', 'states[0].steps[2]']);
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

test('parseStep reads quoted and bare arguments', () => {
  assert.deepEqual(parseStep('click Se connecter'), { verb: 'click', args: ['Se connecter'] });
  assert.deepEqual(parseStep('fill "Mot de passe" "faux"'), { verb: 'fill', args: ['Mot de passe', 'faux'] });
  assert.deepEqual(parseStep('fill Courriel jeanne@example.test'), { verb: 'fill', args: ['Courriel', 'jeanne@example.test'] });
  assert.ok(parseStep('fill Courriel').error);
});

test('the schema and the hand validator agree', () => {
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'));
  const state = schema.$defs.state;
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(state.additionalProperties, false);
  const verbs = new RegExp(state.properties.steps.items.pattern);
  for (const verb of ['click', 'fill', 'wait', 'drop']) assert.ok(verbs.test(`${verb} x`), verb);
  assert.ok(!verbs.test('hover x'));
  const ok = { id: 'a.b', page: '/a', title: 'A', fixture: 'f' };
  // Each required key, when removed, is a finding of the validator.
  for (const key of state.required) {
    const { [key]: _, ...rest } = ok;
    assert.equal(checkAtlas({ states: [rest] }).length, 1, `missing ${key}`);
  }
  assert.deepEqual([...state.required].sort(), ['fixture', 'id', 'page', 'title']);
  // An extra key and a bad id are findings, as the schema says.
  assert.equal(checkAtlas({ states: [{ ...ok, extra: 1 }] }).length, 1);
  assert.equal(checkAtlas({ states: [{ ...ok, id: 'A b' }] }).length, 1);
  assert.ok(new RegExp(state.properties.id.pattern).test('ecritures.empty'));
  assert.ok(!new RegExp(state.properties.id.pattern).test('A b'));
  assert.ok(new RegExp(state.properties.page.pattern).test('/a') && !new RegExp(state.properties.page.pattern).test('a'));
});
