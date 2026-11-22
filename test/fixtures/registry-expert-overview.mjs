// Run inside the isolated consumer of scripts/test-registry-consumer.mjs --expert-overview: the block as the shadcn CLI copied it (bundled by the
// consumer's own esbuild to dist/expert-overview.js) renders the three states from plain props. Nothing of this repository is imported.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExpertOverview, ExpertTrack } from '../../dist/expert-overview.js';

const on = () => {};
const item = id => ({ id, text: `Sentence ${id}.`, action: { label: `Open ${id}`, onAction: on } });
const apps = [{ id: 'a', name: 'Atelier', line: '3 features', onOpen: on }, { id: 'd', name: 'Devis', unreadable: true }];
const done = { label: 'Done · 2 live', items: [{ id: 'x', title: 'Price list' }] };
const steps = ['Framed', 'Proven', 'Rehearsed', 'Accepted'].map(label => ({ id: label, label }));

test('the installed block draws three of five items, then the apps and a folded done', () => {
  const markup = renderToStaticMarkup(h(ExpertOverview, { heading: 'Good evening', needsYou: ['1', '2', '3', '4', '5'].map(item), apps, done }));
  assert.match(markup, /Sentence 3\./); assert.doesNotMatch(markup, /Sentence 4\./);
  assert.match(markup, /Status unreadable/); assert.match(markup, /Done · 2 live/); assert.doesNotMatch(markup, /Price list/);
});

test('with nothing to do it is calm, and the track says its steps and its progress', () => {
  assert.match(renderToStaticMarkup(h(ExpertOverview, { heading: 'x', needsYou: [], calm: { heading: 'Nothing needs you' }, apps })), /Nothing needs you/);
  const track = renderToStaticMarkup(h(ExpertTrack, { title: 'Atelier', steps, features: [{ id: 'f', title: 'Quote letters', status: 'Ready', reached: 3, turn: 'person' }] }));
  assert.match(track, /Rehearsed/); assert.match(track, /Quote letters: Ready, 3 of 4 steps done/);
  assert.throws(() => renderToStaticMarkup(h(ExpertTrack, { title: 'Atelier', steps: steps.slice(0, 3), features: [] })), /steps/);
});
