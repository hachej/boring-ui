import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BAR_FLOATING_PRESET, COMPOSER_PRESETS, composerForScreen, levelsOf, resolveComposer, stripPlan } from '../../registry/app-shell/composer-config.ts';
import { circleReserve, liftOf, reserveOf, slotOf } from '../../registry/app-shell/composer-stack.ts';
import { REVIEW_ROOM, reviewSide } from '../../registry/feedback/review-place.ts';

// shell-composer-everywhere: the common options of the composer config on every launcher (the pure parts: the resolver's levels, the plan with Open in full, the screen's composer, the stack of mixed
// heights, the review's side), and in their own process the real FloatingComposer and AppShell driven in happy-dom (composer-launchers.impl.mjs). The browser journeys are composer-launchers-browser.test.mjs.
const root = fileURLToPath(new URL('../../', import.meta.url));
const state = { expanded: true, snap: 'closed', trayOpen: true, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: true };
const keys = (config, over = {}) => resolveComposer({ composer: config, state: { ...state, ...over } }).actions.map(action => action.key);

test('every launcher has its levels: the circle and the tab two, the bar the sizes and the dock its config gives, the header trigger its docked level', () => {
  assert.deepEqual(levelsOf({ launcher: 'circle' }, false), ['folded', 'open']);
  assert.deepEqual(levelsOf({ launcher: 'tab' }, false), ['folded', 'open']);
  assert.deepEqual(levelsOf({ launcher: 'header' }, false), ['folded', 'open', 'docked']);
  assert.deepEqual(levelsOf(COMPOSER_PRESETS.bar, false), ['folded', 'open', 'grown', 'full', 'docked']);
  assert.deepEqual(levelsOf(COMPOSER_PRESETS.content, false), ['folded', 'open', 'docked']);
  assert.deepEqual(levelsOf(COMPOSER_PRESETS.bar, true), ['folded', 'open', 'grown', 'full'], 'the standalone composer has no dock');
});

test('a handoff adds Open in full to a bar\'s strip while the conversation is open, and nowhere else', () => {
  const handoff = { openFull() {} };
  const bar = { ...COMPOSER_PRESETS.bar, handoff };
  assert.deepEqual(keys(bar), ['reduce', 'more', 'split', 'full', 'openFull'], 'the tray: after the sizes');
  assert.deepEqual(keys(bar, { trayOpen: false }), ['conversation', 'full'], 'at rest: not offered');
  assert.deepEqual(keys(bar, { size: 'full' }), ['back'], 'full screen: its own strip');
  assert.deepEqual(keys({ ...BAR_FLOATING_PRESET, handoff }, { place: 'float' }), ['reduce', 'dock', 'minimise', 'openFull'], 'the floating window');
  assert.deepEqual(keys(COMPOSER_PRESETS.bar), ['reduce', 'more', 'split', 'full'], 'without it: as before');
  assert.deepEqual(keys({ ...bar, on: { openFull() {} }, handoff: undefined }), ['reduce', 'more', 'split', 'full', 'openFull'], 'the shorthand does too');
  const phone = { expanded: false, snap: 'half', trayOpen: false };
  assert.deepEqual(keys(bar, phone), ['conversation', 'more', 'openFull'], 'the phone\'s sheet');
  assert.deepEqual(keys(bar, { ...phone, snap: 'peek' }), ['conversation'], 'the peek has no conversation open');
});

test('NavItem.composer: nothing is the app\'s own, false is the app\'s composer suspended, an object replaces it (and the shell\'s floatingComposer with it)', () => {
  assert.deepEqual(composerForScreen('bar', true, undefined), { composer: 'bar', floating: true });
  const hidden = composerForScreen('bar', true, false);
  assert.equal(hidden.floating, false, 'floatingComposer becomes part of the object');
  assert.equal(hidden.composer.suspended, true);
  assert.equal(hidden.composer.fold, 'circle', 'the bar with floatingComposer keeps its fold and float');
  assert.doesNotThrow(() => resolveComposer({ composer: hidden.composer, floatingComposer: hidden.floating }));
  assert.equal(composerForScreen({ launcher: 'circle', id: 'a' }, false, false).composer.id, 'a', 'an object keeps its id');
  assert.equal(composerForScreen(undefined, false, false).composer.launcher, 'header', 'the default composer is the dock');
  const own = { launcher: 'circle', id: 'support' };
  assert.deepEqual(composerForScreen('bar', true, own), { composer: own, floating: false });
});

test('the stack takes the height of what it stacks, and the reserve covers the highest', () => {
  const launcher = (key, extra = {}) => ({ key, id: key, corner: 'bottom-end', rank: key === 'a' ? 0 : 1, seq: key === 'a' ? 1 : 2, reserve: true, inline: '16px', block: '16px', ...extra });
  const all = [launcher('a', { h: 56, w: 352 }), launcher('b')];
  assert.equal(liftOf(all, all[0]), 0);
  assert.equal(liftOf(all, all[1]), 56 + 12, 'a 56 px bar then a gap');
  assert.equal(slotOf(all, all[1]), 1);
  assert.equal(reserveOf(all).block, 'max(calc(16px + 56px), calc(16px + 120px))');
  assert.equal(reserveOf(all).inline, 'max(calc(16px + 352px), calc(16px + 52px))', 'the wide bar sets the inline footprint');
  assert.equal(reserveOf([launcher('a', { corner: null })]).block, undefined, 'a launcher in the page\'s flow takes no corner');
  assert.equal(liftOf([launcher('a', { corner: null }), launcher('b')], launcher('b')), 0);
  assert.equal(circleReserve('0px', false), '0px');
});

test('the review opens above a chip near the foot and below one anchored at the top', () => {
  assert.equal(REVIEW_ROOM, 320);
  assert.equal(reviewSide({ top: 800, bottom: 840 }, { height: 900 }).side, 'above', 'a chip at the foot');
  assert.equal(reviewSide({ top: 20, bottom: 60 }, { height: 900 }).side, 'below', 'a chip at the top: no room above');
  assert.equal(reviewSide({ top: 400, bottom: 440 }, { height: 900 }).side, 'above', 'in the middle there is room above');
  const small = reviewSide({ top: 150, bottom: 190 }, { height: 800 });
  assert.equal(small.side, 'below', 'less than the room above and more below');
  assert.ok(small.room >= 120 && small.room <= 800, 'it scrolls inside the room it has');
});

test('NavItem.composer is declared on the public type', () => {
  const nav = readFileSync(`${root}registry/app-shell/nav.tsx`, 'utf8');
  assert.match(nav, /readonly composer\?: ComposerConfig \| false;/);
  const layer = readFileSync(`${root}registry/app-shell/layer-context.ts`, 'utf8');
  assert.match(layer, /readonly feedbackSlot\?: FeedbackSlot \| undefined;/, 'AgentSpec.feedbackSlot: a node or a function of the level, the phase, the count and where');
  assert.match(layer, /export type FeedbackSlot = ReactNode \| \(\(context: FeedbackSlotContext\) => ReactNode\);/);
});

test('the real components, in their own process: the options on the bar, the tab, the header trigger, the circle and FloatingComposer, NavItem.composer, the feedback slot', { timeout: 900000 }, () => {
  const impl = fileURLToPath(new URL('./composer-launchers.impl.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 900000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-9000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^(?:# |ℹ )fail 0$/m);
});
