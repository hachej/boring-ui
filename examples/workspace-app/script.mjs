// The scripted model's side of the workspace-app journey (format: ../studio/scripted-model.mjs): what the model answers to each prompt,
// so the journey runs the same way every time without a key. Used with STUDIO_MODEL=scripted. Fictional content only.
import { readFileSync } from 'node:fs';

const call = (name, args) => ({ tools: [{ name, args }] });
// The maquette journey's mock-up: the fictional booking fixture, written and presented as a PM agent would.
const BOOKING = readFileSync(new URL('../../test/fixtures/maquette/booking.maquette.json', import.meta.url), 'utf8');
// The diagram journey's flow: the fictional booking diagram (test/fixtures/diagram/booking.diagram.json).
const FLOW = readFileSync(new URL('../../test/fixtures/diagram/booking.diagram.json', import.meta.url), 'utf8');
const HTML_BOOKING = readFileSync(new URL('../../test/fixtures/booking.mockup.html', import.meta.url), 'utf8');
const NOTES = '# Picnic plan\n\nA fictional picnic by the invented Lake Placeholder.\n\n- Blanket and baskets\n- Lemonade\n';

export const SOURCES = [{ name: 'workspace-app', entries: Object.entries({
  'booking mock-up': [call('write', { path: 'booking.maquette.json', content: BOOKING }), call('present', { path: 'booking.maquette.json' }), 'The booking mock-up is ready.'],
  'booking HTML': [call('write', { path: 'booking.mockup.html', content: HTML_BOOKING }), call('present', { path: 'booking.mockup.html' }), 'The HTML booking mock-up is ready.'],
  'HTML calendar change': ['Noted: the calendar element in booking.mockup.html.'],
  'booking diagram': [call('write', { path: 'booking.diagram.json', content: FLOW }), call('present', { path: 'booking.diagram.json' }), 'The booking diagram is ready.'],
  // The comment pins of the diagram journey arrive with this message (the feedback report, fenced): the PM agent acknowledges them.
  'Two changes on the class list': ['Noted: the class list button and its heading, on screen classes of booking.maquette.json.'],
  'picnic plan': [call('write', { path: 'picnic-plan.md', content: NOTES }), call('present', { path: 'picnic-plan.md' }), 'The picnic plan is ready.'],
}).map(([match, turns]) => ({ match, turns })) }];
