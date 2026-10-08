// The ticket journey (FEEDBACK.md, "Tickets"): one driven Chromium run of the default Fernhill page with the keyless scripted builder
// and the default file sink. Steps: Feedback in the composer → click Save (pinned, never pressed) → a note → Done → Send → the builder
// cites the note → "create a ticket" → the builder loads boring-pm, writes `tickets/<id>.md` with the write tool, presents it and
// replies with the link the file sink wrote into its front matter → the link opens the ticket page (title, notes, the element with
// file:line, the route template, acceptance criteria). No GitHub: the demo names no repository. Screenshots and journey.json go to
// .cache/evidence/feedback-ticket/. Manual evidence, not an npm test.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFeedbackApp } from './server.mjs';
import { parseTicket } from '@hachej/boring-feedback/tickets';
import { launch, pause } from '@hachej/boring-testing/browser';

const evidence = process.env.FEEDBACK_EVIDENCE ?? '.cache/evidence/feedback-ticket';
const chromium = process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`;
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-ticket-'));
const steps = [];
const summary = { journey: 'feedback-ticket', startedAt: new Date().toISOString(), model: 'scripted (keyless)', sink: 'file', steps, screenshots: [], records: {} };
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const q = testid => `document.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const CHAT = `document.querySelector('[data-boring=ambient-chat]')`;
const inChat = testid => `${CHAT}?.querySelector('[data-testid=${JSON.stringify(testid)}]')`;
const TRANSCRIPT = `(${inChat('transcript')}?.innerText ?? '')`;
const IDLE = `${CHAT}.querySelector('[data-testid=ambient-status]')?.dataset.status !== 'working'`;
const SAVE = q('save-profile');
const NOTE = 'It should say what it saves.';
const LINK = /Ticket for (fb_[1-9A-HJ-NP-Za-km-z]{16}) filed \(file\): (http:\/\/127\.0\.0\.1:\d+\/tickets\/([A-Za-z0-9_-]+))/;

const app = await startFeedbackApp({ directory, port: 0 });
let browser;
try {
  browser = await launch(`${app.url}settings/profile`, { chromium, evidence });
  const shot = async name => { await pause(300); await browser.screenshot(`${name}.png`); summary.screenshots.push(join(evidence, `${name}.png`)); };
  const clickAt = async selector => {
    const box = await browser.until(`the centre of ${selector}`, `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
    for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  await browser.until('the page and the Feedback button', `!!(${q('app-root')} && ${inChat('composer-feedback')} && !${inChat('composer-feedback')}.disabled && !${inChat('composer-input')}.disabled)`, 30000);

  let id;
  await step('Feedback: pin Save with a note, Done, Send; the builder cites it', async () => {
    await browser.click(inChat('composer-feedback'));
    await browser.until('the feedback bar', `!!${q('feedback-bar')}`, 5000);
    await clickAt(SAVE);
    await browser.until('the bubble', `!!${q('feedback-bubble-input')}`, 5000);
    await browser.type(q('feedback-bubble-input'), NOTE);
    await browser.press('Enter');
    await browser.until('one note', `${q('feedback-bar-count')}.textContent === '1 note'`, 5000);
    await browser.click(q('feedback-done'));
    await browser.until('the chip', `!!${inChat('feedback-chip')}`, 10000);
    await browser.type(inChat('composer-input'), 'Please fix this.');
    await browser.press('Enter');
    await browser.until('the chip is gone', `!${inChat('feedback-chip')}`, 10000);
    if (await browser.evaluate(`${CHAT}.dataset.state`) !== 'expanded') await browser.click(inChat('ambient-title'));
    await browser.until('the builder replied', `/fb_[1-9A-HJ-NP-Za-km-z]{16}: 1 note/.test(${TRANSCRIPT}) && ${IDLE}`, 30000);
    id = /(fb_[1-9A-HJ-NP-Za-km-z]{16}): 1 note/.exec(await browser.evaluate(TRANSCRIPT))[1];
    summary.records.feedback = id;
    await shot('01-feedback-sent');
  });

  let link, ticketId;
  await step('"create a ticket": load_skill boring-pm, write tickets/<id>.md, present; the reply shows the file-sink link', async () => {
    await browser.type(inChat('composer-input'), 'create a ticket');
    await browser.press('Enter');
    await browser.until('the ticket reply', `${LINK}.test(${TRANSCRIPT}) && ${IDLE}`, 30000);
    const found = LINK.exec(await browser.evaluate(TRANSCRIPT));
    assert.equal(found[1], id, 'the ticket is about the report just sent');
    [, , link, ticketId] = found;
    summary.records.link = link;
    const tools = (await app.messages('ada')).filter(message => message.role === 'toolResult').slice(-4).map(message => message.toolName);
    assert.deepEqual(tools, ['load_skill', 'feedback', 'write', 'present']);
    const read = await app.files.read({ target: { resource: { providerId: 'fernhill-feedback', path: `tickets/${ticketId}.md` }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, app.people.ada.access);
    assert.equal(read.kind, 'available');
    const ticket = parseTicket(ticketId, new TextDecoder().decode(read.snapshot.bytes));
    assert.deepEqual(ticket.outcome, { sink: 'file', url: link });
    summary.records.ticket = { title: ticket.ticket.title, labels: ticket.ticket.labels, fields: ticket.fields };
    const anchor = await browser.evaluate(`[...${CHAT}.querySelectorAll('a')].map(a => a.href).find(href => href === ${JSON.stringify(link)}) ?? null`);
    assert.ok(anchor, "the link in the reply is a real link");
    await shot('02-ticket-reply');
  });

  await step('the link opens the ticket: boring-pm title and labels, the note, Save with file:line, the route, acceptance criteria', async () => {
    await browser.send('Page.navigate', { url: link });
    await browser.until('the ticket page', `!!${q('ticket')}`, 10000);
    const page = await browser.evaluate(`({ title: ${q('ticket-title')}.textContent, fields: ${q('ticket-fields')}.innerText, body: ${q('ticket-body')}.innerText, headings: [...${q('ticket-body')}.querySelectorAll('h3')].map(h => h.textContent) })`);
    assert.equal(page.title, `[besoin] ${NOTE}`);
    assert.match(page.fields, /kind:feature[\s\S]*by:pm-agent/);
    assert.match(page.fields, /\/settings\/:section/);
    assert.match(page.fields, new RegExp(`"sink":"file","url":"${link.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`));
    assert.deepEqual(page.headings, ['Ce qui deviendrait plus simple', "Comment vous faites aujourd'hui", 'Exemples concrets (fictifs)', 'Ce qui ne doit surtout pas changer', 'Elements', 'Acceptance criteria']);
    assert.match(page.body, /«Save profile» button \(examples\/feedback\/settings\/SettingsPage\.jsx:\d+\)/);
    assert.match(page.body, new RegExp(`AC-1: on /settings/:section, the «Save profile» button \\(examples/feedback/settings/SettingsPage\\.jsx:\\d+\\): ${NOTE.replace('.', '\\.')}`));
    summary.records.page = page;
    await shot('03-ticket-page');
  });

  assert.deepEqual(browser.problems.filter(problem => !/favicon|ERR_|Failed to load resource/.test(problem)), [], 'no page errors');
  summary.result = 'pass';
  console.log(`PASS: ${steps.length} steps; screenshots in ${evidence}`);
} catch (error) {
  summary.result = 'fail';
  summary.error = String(error?.stack ?? error);
  await browser?.screenshot('failure.png').catch(() => {});
  process.exitCode = 1;
  console.error(error);
} finally {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify(summary, null, 2));
  await browser?.close();
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
