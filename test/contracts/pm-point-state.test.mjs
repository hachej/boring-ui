import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/pm-point-state-test');
mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(root, 'registry/pm-panel/point-state.ts')], outfile: join(out, 'point-state.mjs'), bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
const { createPointState, pointReducer, marker, alignedTranscript } = await import(pathToFileURL(join(out, 'point-state.mjs')).href);

const chip = (id, overrides = {}) => ({ id, kind: 'carte', label: `Carte ${id}`, screen: '/overview', at: 1, box: [16, 96, 120, 80], ...overrides });
const pick = (state, value) => pointReducer(state, { type: 'pick', chip: value });

test('PM point state starts with Montrer off and select/navigate never owns recording', () => {
  const initial = createPointState();
  assert.deepEqual(initial, { mode: 'sheet', show: false, chips: [], nextNumber: 1 });
  const selecting = pointReducer(initial, { type: 'show', value: true });
  assert.equal(selecting.mode, 'point');
  assert.equal(selecting.show, true);
  const selected = pick(selecting, chip('a'));
  const navigating = pointReducer(selected, { type: 'show', value: false });
  assert.equal(navigating.mode, 'navigate');
  assert.equal(navigating.show, false);
  assert.equal(navigating.chips, selected.chips, 'the 56px in-flow navigation strip retains the composer chips');
  const returned = pointReducer(navigating, { type: 'return' });
  assert.equal(returned.mode, 'sheet');
  assert.equal(returned.show, false, 'Revenir expands the composer without silently enabling Montrer');
  assert.equal(returned.chips, selected.chips);
  assert.equal(pointReducer(returned, { type: 'show', value: true }).show, true);
  assert.deepEqual(Object.keys(navigating).sort(), ['chips', 'mode', 'nextNumber', 'show']);
  assert.deepEqual(initial.chips, [], 'transitions do not mutate the prior snapshot');
});

test('PM chips retain screen/capture and monotonically numbered pins after removal', () => {
  const first = chip('a', { at: 0.5, capture: { mimeType: 'image/png', data: 'AA==' } });
  const second = chip('b', { at: 3, screen: '/progress' });
  const one = pick(createPointState(), first);
  const two = pick(one, second);
  assert.deepEqual(two.chips, [{ ...first, number: 1 }, { ...second, number: 2 }]);
  const removed = pointReducer(two, { type: 'remove', id: 'a' });
  assert.deepEqual(removed.chips.map(value => value.number), [2]);
  assert.equal(two.chips.length, 2);
  const three = pick(removed, chip('c', { screen: '/settings' }));
  assert.deepEqual(three.chips.map(value => value.number), [2, 3]);
  assert.deepEqual(three.chips.map(value => value.screen), ['/progress', '/settings']);
  assert.equal(three.nextNumber, 4);
});

test('PM selection captures its box and screenshot metadata independently of caller mutations', () => {
  const original = chip('a', { capture: { mimeType: 'image/png', data: 'AA==' } });
  const selected = pick(createPointState(), original);
  original.box[1] = 800;
  original.capture.data = 'BB==';
  assert.deepEqual(selected.chips[0].box, [16, 96, 120, 80]);
  assert.equal(selected.chips[0].capture.data, 'AA==');
  assert.equal(selected.mode, 'sheet');
});

test('PM navigation across screens keeps the strip and selections until Revenir', () => {
  let state = pick(createPointState(), chip('a'));
  state = pointReducer(state, { type: 'show', value: false });
  for (const screen of ['/progress', '/settings', '/overview']) {
    // Routing belongs to the host: it replaces no PM state and introduces no recording lifecycle.
    assert.equal(state.mode, 'navigate', screen);
    assert.equal(state.chips[0].screen, '/overview');
  }
  const returned = pointReducer(state, { type: 'return' });
  assert.equal(returned.mode, 'sheet');
  assert.deepEqual(returned.chips, state.chips);
});

test('PM tab-bar targets keep the same strip; the superseded top dock does not exist', () => {
  const pointing = pointReducer(createPointState(), { type: 'show', value: true });
  const tab = pick(pointing, chip('tab', { box: [0, 788, 390, 56] }));
  assert.equal(tab.mode, 'point');
  assert.equal(tab.show, true);
  assert.equal('dock' in tab, false);
});

test('PM full/collapse/sent retain selection preference, not a second recording state', () => {
  const initial = pointReducer(pick(createPointState(), chip('a')), { type: 'show', value: false });
  const full = pointReducer(initial, { type: 'full' });
  assert.equal(full.mode, 'full');
  assert.equal(full.show, false);
  assert.equal(full.chips, initial.chips);
  const collapsed = pointReducer(full, { type: 'collapse' });
  assert.equal(collapsed.mode, 'sheet');
  assert.equal(collapsed.show, false);
  const sent = pointReducer(collapsed, { type: 'sent' });
  assert.deepEqual(sent, { mode: 'full', show: false, chips: [], nextNumber: 1 });
  assert.equal(initial.chips.length, 1);
});

test('a late acknowledgement removes only its captured selection batch', () => {
  const original = pick(createPointState(), chip('a'));
  const later = pick(original, chip('b'));
  const admitted = pointReducer(later, { type: 'sent', ids: ['a'] });
  assert.deepEqual(admitted.chips.map(value => value.id), ['b']);
  assert.equal(admitted.nextNumber, 3);
  assert.equal(admitted.mode, 'full');
});

test('PM pin marker spelling is stable for chips and transcript', () => {
  assert.equal(marker(1), '①');
  assert.equal(marker(2), '②');
  assert.equal(marker(20), '⑳');
  assert.equal(marker(21), '㉑');
  assert.equal(marker(50), '㊿');
  assert.equal(marker(51), '(51)');
});

test('PM transcript inserts pins where timed words were spoken without duplicating text', () => {
  const text = 'cette carte et cette jauge';
  const segments = [{ start: 0, end: 5, text, words: [
    { start: 0, end: 0.7, text: 'cette' }, { start: 0.8, end: 1.5, text: 'carte' },
    { start: 2, end: 2.3, text: 'et' }, { start: 3, end: 3.5, text: 'cette' }, { start: 4, end: 4.8, text: 'jauge' },
  ] }];
  const chips = [{ ...chip('a', { at: 1.6 }), number: 1 }, { ...chip('b', { at: 4.9 }), number: 2 }];
  const aligned = alignedTranscript(text, segments, chips);
  assert.equal(aligned, 'cette carte ① et cette jauge ②');
  assert.equal(aligned.replace(/ [①②]/g, ''), text);
  assert.deepEqual(chips.map(value => value.at), [1.6, 4.9]);
});

test('PM transcript uses segment boundaries when no word timings are available', () => {
  const text = 'cette carte\n\ncette jauge';
  const segments = [{ start: 0, end: 1, text: 'cette carte' }, { start: 3, end: 4, text: 'cette jauge' }];
  const chips = [{ ...chip('a', { at: 1.1 }), number: 1 }, { ...chip('b', { at: 4.2 }), number: 2 }];
  assert.equal(alignedTranscript(text, segments, chips), 'cette carte ①\n\ncette jauge ②');
});

test('PM transcript orders simultaneous markers, preserves repeated text and tolerates removed chips', () => {
  const text = 'cette carte, cette carte';
  const segments = [{ start: 0, end: 1, text: 'cette carte' }, { start: 2, end: 3, text: 'cette carte' }];
  const chips = [{ ...chip('b', { at: 3 }), number: 3 }, { ...chip('a', { at: 1 }), number: 1 }, { ...chip('c', { at: 3 }), number: 4 }];
  assert.equal(alignedTranscript(text, segments, chips), 'cette carte ①, cette carte ③ ④');
  assert.equal(alignedTranscript(text, segments, chips.filter(value => value.id !== 'a')), 'cette carte, cette carte ③ ④');
});

test('PM transcript appends markers honestly without usable timing and never fabricates missing words', () => {
  const text = 'Le texte dicté reste exactement ici.';
  const chips = [{ ...chip('b', { at: 4 }), number: 2 }, { ...chip('a', { at: 1 }), number: 1 }];
  assert.equal(alignedTranscript(text, undefined, chips), `${text} ① ②`);
  assert.equal(alignedTranscript(text, [], chips), `${text} ① ②`);
  assert.equal(alignedTranscript(text, [{ start: 0, end: 1, text: 'un autre texte' }], chips), `${text} ① ②`);
  assert.equal(alignedTranscript(text, [{ start: NaN, end: 1, text }], chips), `${text} ① ②`);
  assert.equal(alignedTranscript('', undefined, chips), '① ②');
  assert.equal(alignedTranscript(text, undefined, []), text);
});
