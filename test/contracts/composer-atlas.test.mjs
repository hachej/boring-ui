import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The composer Atlas (ux/atlas/composer-atlas.json) is the one source of the showcase's Atlas page and of this test. It cannot drift: (1) every state it lists is a real option of the
// code (a member of the unions the shell declares) and every member of those unions has a state or a stated reason; every test id it names is in the registry's source; (2) every state
// is reached and every transition is driven through the real controls in happy-dom (composer-atlas.impl.mjs, its own process).
const root = fileURLToPath(new URL('../../', import.meta.url));
const atlas = JSON.parse(readFileSync(join(root, 'ux/atlas/composer-atlas.json'), 'utf8'));
const text = file => readFileSync(join(root, file), 'utf8');

const walk = dir => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const registrySource = walk(join(root, 'registry')).filter(path => /\.(tsx?|css)$/.test(path)).map(path => readFileSync(path, 'utf8')).join('\n');

/** The members of a union written after `find` in `file`: `'a' | 'b'` or `0 | 1 | 2`. */
export function unionAfter(file, find) {
  const source = text(file), at = source.indexOf(find);
  assert.notEqual(at, -1, `${file} no longer has "${find}": the atlas's union moved or was renamed`);
  const match = /^(?:'[^']+'|\d+)(?:\s*\|\s*(?:'[^']+'|\d+))*/.exec(source.slice(at + find.length));
  assert.ok(match, `${file}: no union after "${find}"`);
  return match[0].split('|').map(member => member.trim().replace(/^'|'$/g, ''));
}

const testIds = () => {
  const ids = new Set();
  const take = value => { for (const found of String(value).matchAll(/data-testid=([\w-]+)/g)) ids.add(found[1]); if (/^[\w-]+$/.test(value)) ids.add(value); };
  const walkSteps = steps => { for (const step of steps ?? []) for (const key of ['click', 'tap', 'on']) if (step[key]) take(step[key]); };
  for (const state of atlas.states) { for (const id of [...(state.detect.has ?? []), ...(state.detect.lacks ?? [])]) take(id); walkSteps(state.reach); }
  for (const transition of atlas.transitions) { for (const way of [transition.trigger.do, ...(transition.trigger.alt ?? []), transition.setup ?? []]) walkSteps(way); for (const id of [...(transition.after?.has ?? []), ...(transition.after?.lacks ?? [])]) take(id); }
  return [...ids];
};

test('atlas data: every state and transition is complete, ids are unique, every transition joins two listed states, every state is entered by one', () => {
  const ids = atlas.states.map(state => state.id);
  assert.equal(new Set(ids).size, ids.length, 'state ids are unique');
  const transitionIds = atlas.transitions.map(transition => transition.id);
  assert.equal(new Set(transitionIds).size, transitionIds.length, 'transition ids are unique');
  for (const state of atlas.states) {
    for (const field of ['id', 'group', 'name', 'scene', 'sees', 'code']) assert.ok(state[field], `${state.id}: ${field}`);
    assert.ok(atlas.scenes[state.scene], `${state.id}: scene ${state.scene}`);
    assert.ok(Array.isArray(state.reach) && state.detect?.has?.length, `${state.id}: reach and detect.has`);
    assert.ok(statSync(join(root, state.code)).isFile(), `${state.id}: code file ${state.code}`);
  }
  for (const transition of atlas.transitions) {
    assert.ok(ids.includes(transition.from) && ids.includes(transition.to), `${transition.id}: both states are listed`);
    assert.ok(['click', 'key', 'drag', 'tap', 'event', 'resize'].includes(transition.trigger.kind), `${transition.id}: trigger kind`);
    assert.ok(transition.trigger.label && transition.trigger.do?.length && transition.guard, `${transition.id}: label, steps and guard`);
    if (transition.scene) assert.ok(atlas.scenes[transition.scene], `${transition.id}: scene`);
  }
  // A state nothing leads to would be a dead listing: it is the rest of its scene (no reach steps) or the target of a transition.
  for (const state of atlas.states) assert.ok(state.reach.length === 0 || atlas.transitions.some(transition => transition.to === state.id), `${state.id} is entered by no transition`);
});

test('atlas options: every state option is a real member of the code\'s unions, and every member of them has a state or a stated reason', () => {
  const members = new Map(atlas.unions.map(union => [union.id, unionAfter(union.file, union.find)]));
  const claimed = new Set();
  for (const state of atlas.states) for (const option of state.options) {
    const [union, member] = option.split(':');
    assert.ok(members.has(union), `${state.id}: unknown union ${union}`);
    assert.ok(members.get(union).includes(member), `${state.id}: ${option} is not an option of the code any more (${union} is ${members.get(union).join(' | ')})`);
    claimed.add(option);
  }
  for (const union of atlas.unions) for (const member of members.get(union.id)) {
    assert.ok(claimed.has(`${union.id}:${member}`) || union.outOfScope?.[member], `${union.id} gained "${member}" in the code: give it a state in the atlas (options: ["${union.id}:${member}"]) or an outOfScope reason`);
  }
});

test('atlas test ids: every test id the atlas reaches or detects is in the registry\'s source', () => {
  for (const id of testIds()) assert.ok(['"', "'", '`', '='].some(quote => registrySource.includes(`${quote}${id}`)), `the registry has no test id ${id}`);
});

test('composer atlas (own process): every state is reached and every transition is driven through the real controls, in happy-dom', () => {
  const impl = fileURLToPath(new URL('./composer-atlas.impl.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 900000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-8000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^(?:# |ℹ )fail 0$/m);
});
