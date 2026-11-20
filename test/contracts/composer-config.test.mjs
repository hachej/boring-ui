import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_CARD_PRESET, BAR_FLOATING_PRESET, COMPOSER_PRESETS, FLOATING_COMPOSER_PRESET, STRIP_ACTIONS, resolveComposer } from '../../registry/app-shell/composer-config.ts';
import { NOT_A_STRIP, STRIPS } from './composer-strips.mjs';

// shell-composer-config: today's `composer` strings are presets of one config; the resolver gives the flags the layer reads and the strip's actions for a state. The expected strips
// (composer-strips.mjs) are keyed by the atlas's own state ids, so a state added to the atlas must be decided here; composer-atlas.impl.mjs reads the same table from the real component.
const root = fileURLToPath(new URL('../../', import.meta.url));
const atlas = JSON.parse(readFileSync(`${root}ux/atlas/composer-atlas.json`, 'utf8'));
const ids = list => list.map(entry => [entry.id, entry.testId]);

test('every atlas state has a strip decided: in the table or with a reason', () => {
  for (const state of atlas.states) assert.ok(state.id in STRIPS || state.id in NOT_A_STRIP, `atlas state ${state.id} is in neither STRIPS nor NOT_A_STRIP (test/contracts/composer-strips.mjs)`);
  for (const id of [...Object.keys(STRIPS), ...Object.keys(NOT_A_STRIP)]) assert.ok(atlas.states.some(state => state.id === id), `${id} is not an atlas state any more`);
});

test('the bar with floatingComposer resolves to today\'s strip in every state of the atlas', () => {
  for (const [id, { state, actions }] of Object.entries(STRIPS)) {
    const got = resolveComposer({ composer: 'bar', floatingComposer: true, state }).actions;
    assert.deepEqual(ids(got), actions, `${id}: the strip's actions and order`);
  }
});

test('the strip without floating offers no float or minimise; the config of the preset resolves to the same strip as the string', () => {
  for (const [id, { state }] of Object.entries(STRIPS)) {
    if (state.place === 'float') continue; // a plain bar never floats: those states are unreachable
    const plain = resolveComposer({ composer: 'bar', state }).actions.map(action => action.key);
    assert.ok(!plain.includes('float') && !plain.includes('minimise'), `${id}: ${plain}`);
    for (const [name, config, floating] of [['bar', COMPOSER_PRESETS.bar, false], ['bar+floating', BAR_FLOATING_PRESET, true]]) {
      const byString = resolveComposer({ composer: 'bar', floatingComposer: floating, state });
      const byConfig = resolveComposer({ composer: config, state });
      assert.deepEqual(byConfig, byString, `${id}: ${name} as a config`);
    }
  }
});

test('the presets resolve to the flags the string compares gave', () => {
  const flags = (composer, floatingComposer = false) => resolveComposer({ composer, floatingComposer }).flags;
  const pick = ({ bar, contentColumn, explore, floatable }) => ({ bar, contentColumn, explore, floatable });
  assert.deepEqual(pick(flags('dock')), { bar: false, contentColumn: false, explore: false, floatable: false });
  assert.deepEqual(pick(flags(undefined)), pick(flags('dock')));
  assert.deepEqual(pick(flags('content')), { bar: false, contentColumn: true, explore: false, floatable: false });
  assert.deepEqual(pick(flags('content', true)), pick(flags('content')), 'floatingComposer only affects the bar');
  assert.deepEqual(pick(flags('bar')), { bar: true, contentColumn: true, explore: false, floatable: false });
  assert.deepEqual(pick(flags('bar', true)), { bar: true, contentColumn: true, explore: false, floatable: true });
  assert.deepEqual(pick(flags('explore')), { bar: false, contentColumn: false, explore: true, floatable: false });
  assert.deepEqual(pick(resolveComposer({ composer: FLOATING_COMPOSER_PRESET }).flags), { bar: true, contentColumn: true, explore: false, floatable: true });
  assert.equal(resolveComposer({ composer: FLOATING_COMPOSER_PRESET }).flags.dock, false, 'the standalone composer has no dock');
  assert.deepEqual(resolveComposer({ composer: AGENT_CARD_PRESET }).flags.sizes, ['open', 'full']);
});

test('the action table is one: every id and test id the strip and the tray header use', () => {
  assert.deepEqual(Object.values(STRIP_ACTIONS).map(action => action.testId).sort(), ['agent-bar-conversation', 'agent-full-back', 'agent-tray-dock', 'agent-tray-full', 'agent-tray-grow', 'agent-tray-reduce', 'composer-dock-bottom', 'composer-float', 'composer-minimise'].sort());
  const placements = readFileSync(`${root}registry/app-shell/agent-placements.tsx`, 'utf8');
  for (const literal of ['agent-tray-dock', 'agent-tray-grow', 'agent-tray-reduce']) assert.ok(!placements.includes(`data-testid="${literal}"`), `the tray header names ${literal} itself instead of reading the table`);
  const parts = readFileSync(`${root}registry/app-shell/agent-bar-parts.tsx`, 'utf8');
  for (const literal of ["testId: 'agent-tray-grow'", "testId: 'agent-tray-full'", "testId: 'agent-tray-dock'", "testId: 'composer-float'", "testId: 'composer-minimise'"]) assert.ok(!parts.includes(literal), `the strip names ${literal} itself`);
});

test('invalid combinations throw', () => {
  const bar = { launcher: 'bar', sizes: ['open', 'grown', 'full'] };
  assert.throws(() => resolveComposer({ composer: { ...bar, sizes: [] } }), /sizes. is empty/);
  assert.throws(() => resolveComposer({ composer: { launcher: 'circle', fold: 'circle' } }), /circle launcher/);
  assert.throws(() => resolveComposer({ composer: { launcher: 'circle', dock: true } }), /circle launcher/);
  assert.throws(() => resolveComposer({ composer: { launcher: 'tab', float: true } }), /tab launcher/);
  assert.throws(() => resolveComposer({ composer: { launcher: 'header', sizes: ['open'] } }), /header launcher/);
  assert.throws(() => resolveComposer({ composer: { ...bar, fold: 'circle' } }), /together/);
  assert.throws(() => resolveComposer({ composer: { ...bar, float: true } }), /together/);
  assert.throws(() => resolveComposer({ composer: BAR_FLOATING_PRESET, floatingComposer: true }), /replaces .floatingComposer./);
  assert.throws(() => resolveComposer({ composer: 'sidebar' }), /not a composer preset/);
});
