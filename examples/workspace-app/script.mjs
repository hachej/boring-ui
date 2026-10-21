// The scripted model's side of the workspace-app journey (format: ../studio/scripted-model.mjs): what the model answers to each prompt,
// so the journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
import { readFileSync } from 'node:fs';

const call = (name, args) => ({ tools: [{ name, args }] });
// The maquette journey's mock-up: the fictional booking fixture, written and presented as a PM agent would.
const BOOKING = readFileSync(new URL('../../test/fixtures/maquette/booking.maquette.json', import.meta.url), 'utf8');
// The diagram journey's flow: the fictional booking diagram (test/fixtures/diagram/booking.diagram.json).
const FLOW = readFileSync(new URL('../../test/fixtures/diagram/booking.diagram.json', import.meta.url), 'utf8');
const HTML_BOOKING = readFileSync(new URL('../../test/fixtures/booking.mockup.html', import.meta.url), 'utf8');
const HOSTILE = readFileSync(new URL('../../test/fixtures/hostile.mockup.html', import.meta.url), 'utf8');
const STOCK = readFileSync(new URL('../../test/fixtures/records/inventaire-atelier.records.json', import.meta.url), 'utf8');
const BROKEN_STOCK = ' {"kind":"records@1", "rows": <fictional>\n';
const NOTES = '# Picnic plan\n\nA fictional picnic by the invented Lake Placeholder.\n\n- Blanket and baskets\n- Lemonade\n';

export const SOURCES = [{ name: 'workspace-app', entries: Object.entries({
  'workshop stock': [call('write', { path: 'inventaire-atelier.records.json', content: STOCK }), call('present', { path: 'inventaire-atelier.records.json' }), 'The fictional workshop stock is ready.'],
  'broken stock': [call('write', { path: 'broken.records.json', content: BROKEN_STOCK }), call('present', { path: 'broken.records.json' }), 'The malformed fictional stock is ready for inspection.'],
  'booking mock-up': [call('write', { path: 'booking.maquette.json', content: BOOKING }), call('present', { path: 'booking.maquette.json' }), 'The booking mock-up is ready.'],
  'booking HTML': [call('write', { path: 'booking.mockup.html', content: HTML_BOOKING }), call('present', { path: 'booking.mockup.html' }), 'The HTML booking mock-up is ready.'],
  'sandbox probe': [call('write', { path: 'hostile.mockup.html', content: HOSTILE }), call('present', { path: 'hostile.mockup.html' }), 'The sandbox probe is ready.'],
  'HTML calendar change': ['Noted: the calendar element in booking.mockup.html.'],
  'booking diagram': [call('write', { path: 'booking.diagram.json', content: FLOW }), call('present', { path: 'booking.diagram.json' }), 'The booking diagram is ready.'],
  // The comment pins of the diagram journey arrive with this message (the feedback report, fenced): the PM agent acknowledges them.
  'Two changes on the class list': ['Noted: the class list button and its heading, on screen classes of booking.maquette.json.'],
  'picnic plan': [call('write', { path: 'picnic-plan.md', content: NOTES }), call('present', { path: 'picnic-plan.md' }), 'The picnic plan is ready.'],
}).map(([match, turns]) => ({ match, turns })) }];
