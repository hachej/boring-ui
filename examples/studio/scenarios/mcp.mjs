// MCP tools through Pi's own client (../../shared/mcp-tools.mjs) on the fictional harbour server (../fixtures/mcp-server.mjs): the read the
// host lists as read-only runs at once, the write waits for the person's Approve (and never reaches the server on Deny), and the tool the
// host does not allow is not offered at all.
import assert from 'node:assert/strict';
import { call } from './_script.mjs';
import { harbourBookings } from '../fixtures/mcp-server.mjs';

const PROMPTS = {
  tides: 'What are the tides at Placeholder Pier on 2031-05-04? Use the harbour tool.',
  book: 'Book a mooring for the Fictional Gull on 2031-05-04 with the harbour tool.',
  again: 'Book another mooring for the Invented Tern on 2031-05-05 with the harbour tool.',
  close: 'Close the harbour with the harbour tool.',
  invalid: 'Book a mooring for 2031-05-06 with the harbour tool; I will not name the boat.',
};
const offered = (name, args) => ctx => ctx.tools.includes(name) ? call(name, args) : `${name} is not offered.`;
let before;

export default {
  id: 'mcp-harbour', group: 'MCP tools', title: 'Use a connected MCP service', requires: ['mcp'],
  description: 'Read tides from a fictional MCP server, book a mooring after your approval, refuse one, find no tool to close the harbour, and see arguments that do not match the schema refused.',
  steps: [
    { run: () => { before = harbourBookings.length; } },
    // No answers: an approval card here would leave the step waiting, so the read running at once is part of the check.
    { prompt: PROMPTS.tides },
    { prompt: PROMPTS.book, answers: ['approve'] },
    { prompt: PROMPTS.again, answers: ['deny'] },
    { prompt: PROMPTS.close },
    // Arguments that do not match the server's schema are refused by Pi before the approval gate: no card (no answers here), no call.
    { prompt: PROMPTS.invalid },
  ],
  script: {
    [PROMPTS.tides]: [offered('harbour_tide_times', { date: '2031-05-04' }), ctx => `The harbour says: ${ctx.last.text}`],
    [PROMPTS.book]: [offered('harbour_book_mooring', { boat: 'Fictional Gull', date: '2031-05-04' }), ctx => `The harbour says: ${ctx.last.text}`],
    [PROMPTS.again]: [offered('harbour_book_mooring', { boat: 'Invented Tern', date: '2031-05-05' }), ctx => `Not booked: ${ctx.last.text}`],
    [PROMPTS.invalid]: [offered('harbour_book_mooring', { date: '2031-05-06' }), ctx => `Refused before the harbour: ${ctx.last.isError ? 'error' : 'ok'}: ${ctx.last.text}`],
    [PROMPTS.close]: [ctx => ctx.tools.includes('harbour_close_harbour') ? call('harbour_close_harbour', {}) : `I have no tool to close the harbour (harbour tools: ${ctx.tools.filter(name => name.startsWith('harbour_')).join(', ')}).`],
  },
  expect: [
    { reply: /The harbour says: Tides at Placeholder Pier on 2031-05-04: high 06:12/ },
    { reply: /The harbour says: Mooring \d+ booked for Fictional Gull on 2031-05-04\./ },
    { reply: /Not booked: Denied by the person\. harbour_book_mooring was not run/ },
    { reply: /I have no tool to close the harbour \(harbour tools: harbour_tide_times, harbour_book_mooring\)\./ },
    { toolNotCalled: 'harbour_close_harbour' },
    { reply: /Refused before the harbour: error: [^]*Validation failed for tool "harbour_book_mooring"[^]*boat: must have required properties boat/ },
    { replyNot: /is not offered|harbour is closed/ },
  ],
  async verify(t) {
    // What reached the server: the approved booking only.
    assert.deepEqual(harbourBookings.slice(before).map(booking => booking.boat), ['Fictional Gull']);
    assert.deepEqual(t.answered, ['approve', 'deny']);
    const summaries = await t.browser.evaluate(`${t.qa('[data-testid=approval-card] [data-testid=approval-summary]')}.map(e => e.textContent)`);
    assert.deepEqual(summaries, ['harbour: book_mooring {"boat":"Fictional Gull","date":"2031-05-04"}', 'harbour: book_mooring {"boat":"Invented Tern","date":"2031-05-05"}']);
  },
};
