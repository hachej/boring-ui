import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CIRCLE_ACTIONS, resolveComposer } from '../../registry/app-shell/composer-config.ts';
import { AVOID_GAP, CIRCLE_SIZE, STACK_GAP, avoidShift, circleReserve, reserveOf, slotOf, stackLift } from '../../registry/app-shell/composer-stack.ts';

// shell-composer-circle, shell-composer-stack, shell-composer-handoff: the pure parts (the resolver's rules, the stack and the avoid arithmetic) and, in their own process, the real
// FloatingComposer and AppShell driven in happy-dom (composer-circle.impl.mjs). The browser journey is composer-circle-browser.test.mjs.
const circle = (extra = {}) => ({ launcher: 'circle', ...extra });
const state = { expanded: true, snap: 'half', trayOpen: false, dockOpen: false, size: 'open', place: 'bottom', anchored: false, docks: false };

test('the circle resolves to its own flags: no bar, no dock column, no floating, one panel', () => {
  const { flags } = resolveComposer({ composer: circle({ id: 'support' }), standalone: true });
  assert.deepEqual({ circle: flags.circle, bar: flags.bar, floatable: flags.floatable, dock: flags.dock, contentColumn: flags.contentColumn, explore: flags.explore, id: flags.id }, { circle: true, bar: false, floatable: false, dock: false, contentColumn: false, explore: false, id: 'support' });
  assert.deepEqual(flags.sizes, ['open']);
  assert.equal(resolveComposer({ composer: 'bar' }).flags.circle, false, 'the strings are not circles');
});

test('the circle\'s strip is derived from the config: Open in full only with a handoff, Close always, annotate with a pointing tool', () => {
  const plan = (config, extra = {}) => resolveComposer({ composer: config, state: { ...state, ...extra } }).actions.map(action => action.id);
  assert.deepEqual(plan(circle()), ['close']);
  assert.deepEqual(plan(circle({ handoff: { openFull() {} } })), ['open-full', 'close']);
  assert.deepEqual(plan(circle({ on: { openFull() {} } })), ['open-full', 'close']);
  assert.deepEqual(plan(circle({ handoff: { openFull() {} } }), { feedback: true }), ['annotate', 'open-full', 'close']);
  assert.deepEqual(plan(circle({ handoff: { openFull() {} } }), { snap: 'closed' }), [], 'folded: the circle has no strip');
  assert.deepEqual(Object.values(CIRCLE_ACTIONS).map(action => action.testId), ['composer-annotate-title', 'composer-open-full', 'agent-layer-close']);
});

test('invalid combinations throw with a message that names the fix', () => {
  const bad = (composer, pattern, extra = {}) => assert.throws(() => resolveComposer({ composer, ...extra }), pattern);
  bad(circle({ sizes: ['open', 'grown'] }), /take 'grown' and 'full' out of `sizes`.*handoff\.openFull/);
  bad(circle({ level: 'docked', on: { level() {} } }), /two levels.*handoff\.openFull/);
  bad(circle({ defaultLevel: 'full' }), /two levels/);
  bad(circle({ level: 'open' }), /pass `on\.level`.*`defaultLevel`/);
  bad(circle({ handoff: { openFull() {} }, on: { openFull() {} } }), /keep one/);
  bad(circle({ handoff: { openFull() {}, then: 'leave' } }), /`handoff\.then`/);
  bad(circle({ feedback: { while: 'full' } }), /`feedback\.while`/);
  bad(circle({ at: { place: 'right-edge' } }), /sits in a corner.*bottom-end/);
  bad(circle({ at: { stack: -1 } }), /`at\.stack`/);
  bad(circle({ at: { offset: { block: '' } } }), /`at\.offset\.block`/);
  bad(circle({ id: '' }), /`id`/);
  // The common options are every launcher's (the bar, the tab and the header take them); what stays invalid names its fix.
  bad({ launcher: 'bar', sizes: ['open'], level: 'open' }, /`level` is controlled: pass `on\.level`/);
  bad({ launcher: 'bar', sizes: ['open'], level: 'grown', on: { level() {} } }, /bar launcher has no 'grown' level.*add 'grown' to `sizes`/);
  bad({ launcher: 'bar', sizes: ['open'], dock: false, defaultLevel: 'docked' }, /no 'docked' level.*dock: true/);
  bad({ launcher: 'tab', defaultLevel: 'full' }, /tab launcher has no 'full' level/);
  bad({ launcher: 'bar', sizes: ['open'], at: { stack: -1 } }, /`at\.stack`/);
  bad({ launcher: 'bar', sizes: ['open'], at: { place: 'nowhere' } }, /`at\.place`/);
  bad({ launcher: 'bar', sizes: ['open'], reserve: 'some' }, /`reserve`/);
  bad({ launcher: 'bar', sizes: ['open'], avoid: [4] }, /`avoid` is a list/);
  bad({ launcher: 'tab', handoff: { openFull() {}, then: 'leave' } }, /`handoff\.then`/);
  bad({ launcher: 'bar', sizes: ['open'], feedback: { while: 'grown' } }, /`feedback\.while`/);
  bad({ launcher: 'bar', sizes: ['open'], handoff: { openFull() {} }, on: { openFull() {} } }, /keep one/);
  for (const composer of [{ launcher: 'bar', sizes: ['open', 'grown'], dock: true, avoid: ['.x'], layer: 30, reserve: 'none', level: 'grown', on: { level() {} }, note: () => null, feedback: { while: 'folded' }, handoff: { openFull() {} }, suspended: true, at: { offset: { inline: 4 }, stack: 2, remember: false }, id: 'a' },
    { launcher: 'tab', avoid: ['.x'], defaultLevel: 'open', handoff: { openFull() {} } }, { launcher: 'header', suspended: true, note: () => 'x', at: { offset: { block: 8 } } }]) assert.doesNotThrow(() => resolveComposer({ composer }), 'the common options are valid on every launcher');
  bad({ launcher: 'bar', dock: true }, /FloatingComposer. has no side dock/, { standalone: true });
  bad({ launcher: 'header' }, /no header trigger/, { standalone: true });
  bad(circle(), /replaces .start., .onOpenFull./, { legacy: ['start', 'onOpenFull'] });
  bad(circle(), /replaces .floatingComposer./, { floatingComposer: true });
  bad(42, /preset string, a config object or a function/);
  assert.doesNotThrow(() => resolveComposer({ composer: { launcher: 'bar', sizes: ['open', 'grown', 'full'], dock: false, fold: 'circle', float: { movable: true } }, standalone: true }), 'the standalone default as a config');
});

test('launchers stack along the corner: lowest rank nearest, ties by mount order, 52 px and a 12 px gap', () => {
  const all = [{ key: 'a', corner: 'bottom-end', rank: 2, seq: 1 }, { key: 'b', corner: 'bottom-end', rank: 1, seq: 2 }, { key: 'c', corner: 'bottom-start', rank: 1, seq: 3 }, { key: 'd', corner: 'bottom-end', rank: 1, seq: 4 }];
  assert.deepEqual(all.map(one => slotOf(all, one)), [2, 0, 0, 1], 'by rank, then mount order; another corner is its own stack');
  assert.equal(stackLift(0), 0);
  assert.equal(stackLift(2), 2 * (CIRCLE_SIZE + STACK_GAP));
});

test('the reserve is the footprint of the bottom stacks: from the window edge to the top launcher, and in from the end edge', () => {
  const one = (extra = {}) => ({ key: {}, id: undefined, corner: 'bottom-end', rank: 1, seq: 1, reserve: true, inline: '16px', block: '16px', ...extra });
  assert.deepEqual(reserveOf([]), { block: undefined, inline: undefined });
  assert.deepEqual(reserveOf([one()]), { block: 'calc(16px + 52px)', inline: 'calc(16px + 52px)' });
  const second = one({ rank: 2, seq: 2 });
  assert.equal(reserveOf([one(), second]).block, 'max(calc(16px + 52px), calc(16px + 116px))', 'the second launcher is one slot higher');
  assert.deepEqual(reserveOf([one({ reserve: false })]), { block: undefined, inline: undefined }, 'reserve: none');
  assert.deepEqual(reserveOf([one({ corner: 'top-end' })]), { block: undefined, inline: undefined }, 'a top corner takes no room from the foot');
  assert.equal(circleReserve('0px', false), '0px', 'no circle: the screens\' reserve is the bar\'s, as it was');
  assert.match(circleReserve('0px', true), /var\(--composer-reserve-block, 0px\).*var\(--app-shell-tabbar, 0px\)/, 'with a circle the tab bar is not counted twice');
});

test('avoid: a box steps past the rectangles it would cover, away from its corner, and stays put when it is clear', () => {
  const natural = { left: 1332, right: 1384, top: 800, bottom: 852 };
  const rect = (left, right, top = 780, bottom = 900) => ({ left, right, top, bottom });
  assert.equal(avoidShift('bottom-end', false, natural, []), 0);
  assert.equal(avoidShift('bottom-end', false, natural, [rect(1000, 1100)]), 0, 'clear: no move');
  assert.equal(avoidShift('bottom-end', false, natural, [rect(1340, 1440)]), 1384 - 1340 + AVOID_GAP, 'a drawer tab at the right edge: left of it');
  assert.equal(avoidShift('bottom-end', false, natural, [rect(1340, 1440, 100, 200)]), 0, 'a rectangle above it is not in the way');
  assert.equal(avoidShift('bottom-end', false, natural, [rect(1340, 1440), rect(1250, 1300)]), 1384 - 1250 + AVOID_GAP, 'two in a row: past both');
  assert.equal(avoidShift('bottom-start', false, { left: 16, right: 68, top: 800, bottom: 852 }, [rect(0, 40)]), 40 - 16 + AVOID_GAP, 'a start corner steps to the other side');
  assert.equal(avoidShift('bottom-end', true, { left: 16, right: 68, top: 800, bottom: 852 }, [rect(0, 40)]), 40 - 16 + AVOID_GAP, 'right to left: the end is the left');
});

test('circle launcher (own process): the tap opens the panel, Open in full, suspended, stored places, Esc, stacking, controlled level, note, throws, AppShell, 390', () => {
  const impl = fileURLToPath(new URL('./composer-circle.impl.mjs', import.meta.url));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', impl], { encoding: 'utf8', timeout: 900000, env });
  assert.equal(result.status, 0, `${result.stdout.slice(-8000)}\n${result.stderr.slice(-2000)}`);
  assert.match(result.stdout, /^(?:# |ℹ )fail 0$/m);
});
