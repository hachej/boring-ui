import assert from 'node:assert/strict';
import test from 'node:test';
import { barReserve } from '../../registry/app-shell/bar-reserve.ts';

// shell-bar-reserve: what the shell keeps free under a screen for the assistant's bottom bar, as a pure function of the layer's state.
const phone = { phoneBar: true, snap: 'peek', peekPx: 96, tabbarPx: 0 };

test('the peek covers the screen by its own height, the tab bar already sits under the screen', () => {
  assert.equal(barReserve({ ...phone, peekPx: 96 + 57, tabbarPx: 57 }), '96px');
});

test('the card above the field makes the reserve grow with it', () => {
  assert.equal(barReserve({ ...phone, peekPx: 96 + 57 + 112, tabbarPx: 57 }), '208px');
});

test('with no tab bar the safe area is part of the reserve', () => {
  assert.equal(barReserve(phone), 'calc(96px + env(safe-area-inset-bottom, 0px))');
});

test('half and full cover the page on purpose, and a closed layer covers nothing', () => {
  for (const snap of ['half', 'full', 'closed']) assert.equal(barReserve({ ...phone, snap }), '0px');
});

test('a wide screen or a layer with no bar reserves nothing, whatever the numbers say', () => {
  assert.equal(barReserve({ ...phone, phoneBar: false }), '0px');
});

test('a tab bar taller than the peek never gives a negative length', () => {
  assert.equal(barReserve({ ...phone, peekPx: 40, tabbarPx: 57 }), '0px');
});
