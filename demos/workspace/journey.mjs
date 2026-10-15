// Real-browser journey for the workspace demo (scripted model, no key): one person, one accounts-payable week, a dozen moments.
//   1  chat docked: "what needs my approval this week?" and the agent opens the Approvals queue in the viewer
//   2  the person opens an invoice (PDF and extracted fields)
//   a  the history icon in the chat header lists earlier conversations (a search field with an Archived icon toggle); switching keeps each transcript
//   3  the person clicks another invoice; the agent sees it (screen context) and spots a duplicate
//   b  the Library icon in the chat header opens the file list; the AP policy opened from it in the right column; "does this invoice respect the policy?" is answered from the document and the invoice
//   c  attaching a file uploads it into the workspace (a file card in the message); the composer has no microphone without a transcription key
//   d  "create a new file tt.md and open it": the agent writes it (history entry 'agent', no receipt) and opens it in the viewer; the Library lists it live
//   4  the agent proposes "approve, coded to another account"; the person approves the card; the backend returns a receipt
//   5  dragging the divider floats the chat: placement is floating, the right column takes the full width
//   6  on the supplier page "why is this flagged?" gets a short answer and the page does not move
//   7  docking back restores the chat column and the conversation goes on
// Screenshots go to .cache/evidence/workspace-demo/. Run: npm run workspace-demo:journey
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceDemo } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/workspace-demo';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const rect = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right }; })()`;
const placement = `${q('[data-dock=chat]')}?.dataset.placement`;
const INPUT = q('[data-testid=composer-input]');
const body = `document.body.innerText`;
const viewing = `${q('[data-testid=viewing]')}?.textContent`;

const app = await startWorkspaceDemo({ directory: mkdtempSync(join(tmpdir(), 'boring-workspace-demo-')) });
const { connectRevisionProvider } = await import('@hachej/boring-files/revision');
const reader = await connectRevisionProvider({ endpoint: new URL('/api/resources', app.url), fetch: request => { const headers = new Headers(request.headers); headers.set('authorization', `Bearer ${app.token}`); return fetch(new Request(request, { headers })); } });
let browser;
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  if (process.env.APP_SCHEME) await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.APP_SCHEME }] });
  const say = async text => { await browser.until('the composer', `!!${INPUT}`, 20000); await browser.type(INPUT, text); await browser.press('Enter'); };
  const sees = (label, text, timeout = 30000) => browser.until(label, `${body}.includes(${JSON.stringify(text)})`, timeout);
  const click = (label, expression) => browser.click(expression).then(() => label);
  const mouse = (type, x, y) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const lastContext = () => app.contexts.at(-1)?.value;
  // The request context is the screen's fields with `placement` beside them (and this tab's id, which addresses the agent's commands).
  const screenOf = value => ({ name: value.name, params: value.params });
  const history = () => browser.evaluate(placement).then(async where => {
    if (!(await browser.evaluate(`!!${q('[data-testid=conversations]')}`))) await browser.click(q(where === 'floating' ? '[data-testid=ambient-action-history]' : '[data-testid=chat-action-history]'));
    await browser.until('the conversations list', `!!${q('[data-testid=conversations]')}`, 10000);
  });
  const library = async () => {
    const where = await browser.evaluate(placement);
    await browser.click(q(where === 'floating' ? '[data-testid=ambient-action-library]' : '[data-testid=chat-action-library]'));
    await browser.until('the Library', `!!${q('[data-testid=library-popover]')}`, 10000);
  };
  const openConversation = async title => { await history(); await browser.click(row(title)); await browser.until('the list closed', `!${q('[data-testid=conversations]')}`, 5000); };
  const row = title => `[...document.querySelectorAll('[data-testid=conversation-row]')].find(item => item.innerText.includes(${JSON.stringify(title)}))`;

  await step('start: three columns, the chat docked, earlier conversations listed', async () => {
    await browser.until('the chat is live', `!!${INPUT}`, 30000);
    assert.equal(await browser.evaluate(placement), 'docked');
    assert.ok(await browser.evaluate(`!!${q('[data-testid=right-column]')} && !${q('[data-testid=conversations]')} && !${q('[data-testid=connection]')}`), 'chat and right column only: no sessions pane, no Live badge');
    assert.ok(await browser.evaluate(`!!${q('[data-testid=chat-action-history]')} && !!${q('[data-testid=chat-action-library]')}`), 'history and Library icons in the chat header');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=composer-attach]')} || !!${q('[data-testid=composer-file]')}`), true, 'the composer can attach files');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=composer-voice]')}`), false, 'no microphone without a transcription key');
    await history();
    const titles = await browser.evaluate(`[...document.querySelectorAll('[data-testid=conversation-row]')].map(item => item.innerText)`);
    for (const title of ['Month-end close checklist', 'Fernhill Labels terms', "This week's approvals"]) assert.ok(titles.some(text => text.includes(title)), `${title} in ${JSON.stringify(titles)}`);
    assert.equal(await browser.evaluate(viewing), 'Approvals');
    await pause(300);
    await browser.screenshot('1-start-history.png');
    // One search field with a compact icon toggle for Archived (no text button); pressing it toggles the filter.
    assert.equal(await browser.evaluate(`document.querySelectorAll('[data-testid=conversations] input[type=search]').length`), 1);
    const archived = `${q('[data-testid=conversations-archived]')}`;
    assert.deepEqual(await browser.evaluate(`({ text: ${archived}.textContent.trim(), label: ${archived}.getAttribute('aria-label'), pressed: ${archived}.getAttribute('aria-pressed') })`), { text: '', label: 'Archived', pressed: 'false' });
    await browser.click(archived);
    await browser.until('the filter is on', `${archived}.getAttribute('aria-pressed') === 'true'`, 5000);
    await browser.click(archived);
    await browser.until('the filter is off', `${archived}.getAttribute('aria-pressed') === 'false'`, 5000);
    await browser.press('Escape');
    await browser.until('the list closed', `!${q('[data-testid=conversations]')}`, 5000);
    await browser.screenshot('1-start.png');
  });

  await step('1 docked: the agent opens the Approvals queue in the viewer', async () => {
    // Open another screen first, so the agent visibly moves the page.
    await browser.click(q('[data-testid=queue-row-INV-2044]'));
    await browser.until('INV-2044 open', `${viewing} === 'Invoice INV-2044'`, 10000);
    await say('Hello, what needs my approval this week?');
    await sees('the answer', 'I opened the queue in the viewer.');
    await browser.until('the queue is on show', `${viewing} === 'Approvals' && !!${q('[data-testid=approval-queue]')}`, 10000);
    assert.equal(lastContext().placement, 'docked');
    assert.deepEqual(screenOf(lastContext()), { name: 'Invoice', params: { id: 'INV-2044' } }, 'the request carried the screen the person was on');
    assert.deepEqual(app.navigation.map(item => item.screen), ['approvals']);
    await browser.until('three rows', `document.querySelectorAll('[data-testid^=queue-row-]').length === 3`, 5000);
    await browser.screenshot('2-approvals.png');
  });

  await step('2 the person opens an invoice: PDF and extracted fields', async () => {
    await browser.click(q('[data-testid=queue-row-INV-2041]'));
    await browser.until('the invoice', `${viewing} === 'Invoice INV-2041' && /1,284\\.00/.test(${q('[data-testid=invoice-summary]')}?.innerText ?? '')`, 10000);
    const fields = await browser.evaluate(`${q('[data-testid=invoice-summary]')}.innerText`);
    for (const text of ['Linden Print Co', 'LP-7710', 'PO-771', '6200 Printing']) assert.ok(fields.includes(text), `${text} in the fields`);
    await browser.until('the PDF viewer', `!!${q('[data-testid=invoice-pdf] [data-pdf]')}`, 15000);
    await pause(500);
    await browser.screenshot('3-invoice.png');
  });

  await step('a earlier conversations: switching keeps each transcript', async () => {
    await openConversation('Month-end close');
    await sees('the earlier transcript', 'Left in the close: accruals for March');
    assert.ok(!(await browser.evaluate(body)).includes('I opened the queue in the viewer.'), 'the other conversation is not shown');
    await openConversation('Fernhill Labels');
    await sees('the second earlier transcript', 'Fernhill Labels is on net 30');
    await openConversation("This week's approvals");
    await sees('the current transcript is back', 'I opened the queue in the viewer.');
  });

  await step('3 the person clicks another invoice; the agent follows and spots the duplicate', async () => {
    await browser.until('a duplicate alert on INV-2041', `!!${q('[data-testid=duplicate-alert]')}`, 5000);
    await browser.click(`[...document.querySelectorAll('[data-testid=duplicate-alert] button')].find(item => item.textContent === 'INV-2043')`);
    await browser.until('INV-2043 open', `${viewing} === 'Invoice INV-2043'`, 10000);
    await say('Anything odd about this one?');
    await sees('the duplicate is named', 'INV-2043 looks like a duplicate of INV-2041');
    assert.deepEqual(screenOf(lastContext()), { name: 'Invoice', params: { id: 'INV-2043' } });
    assert.equal(app.navigation.length, 1, 'answering did not move the page');
  });

  await step('b the AP policy opened from the Library; the answer uses the document and the invoice', async () => {
    await library();
    await browser.until('the Library lists top-level folders, no nested Library folder', `!!${q('[role=treeitem][data-path="Policies"]')} && !!${q('[role=treeitem][data-path="Contracts"]')} && !${q('[role=treeitem][data-path="Library"]')}`, 15000);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('[data-testid=library-popover] button')].some(item => item.textContent.trim() === 'Refresh')`), false, 'no text Refresh button');
    await browser.screenshot('4a-library.png');
    await browser.click(q('[role=treeitem][data-path="Policies"]'));
    await browser.until('the policy in the tree', `!!${q('[role=treeitem][data-path="Policies/AP policy.md"]')}`, 15000);
    await browser.click(q('[role=treeitem][data-path="Policies/AP policy.md"]'));
    await browser.until('the policy in the right column', `${q('[data-testid=library-document]')}?.dataset.path === 'Policies/AP policy.md'`, 15000);
    await browser.until('its text', `${q('[data-testid=library-document]')}.innerText.includes('Approval limits')`, 15000);
    await browser.until('the Library closed after picking', `!${q('[data-testid=library-popover]')}`, 5000);
    await say('Does this invoice respect the policy?');
    await sees('the answer cites the policy and the invoice', 'No. Section 2 of the policy holds an invoice');
    assert.deepEqual(screenOf(app.contexts.at(-1).value), { name: 'Library document', params: { path: 'Policies/AP policy.md' } }, 'the screen context names the open document');
    const tools = await browser.evaluate(`[...document.querySelectorAll('[data-testid=tool-name]')].map(item => item.textContent.trim()).join(' ')`);
    assert.ok(/read/.test(tools) && /get_invoice/.test(tools), `the agent read the document and the invoice: ${tools}`);
    await browser.screenshot('4-policy.png');
    // The document is editable: leaving it with an unsaved edit asks first, and declining keeps the document and the edit.
    await browser.click(q('[data-testid=library-document] [data-testid$=-mode-source]'));
    await browser.type(q('[data-testid=library-document] textarea.boring-markdown-source'), ' Draft edit.');
    await browser.until('the edit is unsaved', `/Unsaved/.test(${q('[data-testid=library-document]')}.innerText)`, 10000);
    await browser.evaluate(`window.__asked = 0; window.confirm = () => { window.__asked++; return false; }`);
    await browser.click(q('[data-testid=nav-approvals]'));
    await pause(300);
    assert.equal(await browser.evaluate('window.__asked'), 1, 'leaving asked once');
    assert.equal(await browser.evaluate(viewing), 'Policies/AP policy.md', 'declining stays on the document');
    assert.ok((await browser.evaluate(`${q('[data-testid=library-document] textarea.boring-markdown-source')}.value`)).includes('Draft edit.'), 'the edit is still there');
    await browser.evaluate(`window.confirm = () => true`);
    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.until('left the document', `${viewing} === 'Approvals'`, 5000);
  });

  await step('4 the agent proposes approve-and-recode; the person approves; the backend returns a receipt', async () => {
    await say('What would you do with them?');
    await browser.until('the approval card', `${q('[data-testid=approval-card]')}?.dataset.state === 'pending'`, 30000);
    assert.equal(await browser.evaluate(`${q('[data-testid=approval-summary]')}.innerText`), 'Approve INV-2041 coded to 6300 Marketing');
    assert.equal((await app.ap.read('INV-2041')).status, 'pending', 'nothing is saved before the person approves');
    const reviewed = (await app.ap.read('INV-2041')).revision;
    assert.ok((await browser.evaluate(`${q('[data-testid=approval-args]')}.textContent`)).includes(reviewed), 'the card carries the reviewed revision');
    await browser.screenshot('5-approval.png');
    await browser.click(q('[data-testid=approval-approve]'));
    await sees('the receipt in the answer', 'Done: INV-2041 is approved and coded to 6300 Marketing. Receipt decide-');
    const receiptId = /Receipt (decide-[0-9a-f]+)/.exec(await browser.evaluate(body))[1];
    // Repeating the committed decision returns the same receipt; any other decision on the old revision is refused.
    const again = await app.ap.decide({ invoice: 'INV-2041', action: 'recode', account: '6300 Marketing', expected: reviewed });
    assert.deepEqual([again.kind, again.receipt.operationId], ['committed', receiptId]);
    assert.equal((await app.ap.decide({ invoice: 'INV-2041', action: 'hold', expected: reviewed })).kind, 'conflict');
    const saved = await app.ap.read('INV-2041');
    assert.deepEqual([saved.status, saved.account, saved.recodedFrom], ['approved', '6300 Marketing', '6200 Printing']);
    assert.equal((await app.ap.read('INV-2043')).status, 'pending');
    // The page shows the saved invoice (the agent opened it: the chat is docked).
    await browser.until('INV-2041 approved on the page', `${viewing} === 'Invoice INV-2041' && ${q('[data-testid=invoice-status]')}?.textContent === 'approved' && ${q('[data-testid=invoice-account]')}?.textContent === '6300 Marketing'`, 15000);
    assert.equal((await app.ap.read('INV-2041')).status, 'approved', 'one write, however often it is repeated');
  });

  await step('4b a decision on a revision nobody reviewed is refused through the same tool and card', async () => {
    await say('Now hold INV-2043, please.');
    const cards = `[...document.querySelectorAll('[data-testid=approval-card]')]`;
    await browser.until('a second approval card', `${cards}.length === 2 && ${cards}.at(-1).dataset.state === 'pending'`, 30000);
    await browser.click(`${cards}.at(-1).querySelector('[data-testid=approval-approve]')`);
    await sees('the refusal', 'Not saved: The invoice changed since it was reviewed.');
    assert.equal((await app.ap.read('INV-2043')).status, 'pending', 'nothing was written');
  });

  await step('c attaching a file uploads it into the workspace and the message carries a file card', async () => {
    const note = join(mkdtempSync(join(tmpdir(), 'boring-demo-note-')), 'vendor-note.txt');
    writeFileSync(note, 'Linden Print asks for payment by the 3rd.\n');
    await browser.until('the composer', `!!${INPUT}`, 20000);
    await browser.attachFiles(q('[data-testid=composer-file]'), [note]);
    await browser.until('the upload is saved and attached as a file mention', `/^uploads\\/vendor-note.*\\.txt$/.test(${q('[data-testid=mention-chip]')}?.dataset.path ?? '')`, 15000);
    await browser.screenshot('4c-attachment-chip.png');
    await say('Please look at the attached note.');
    await browser.until('a file card in the message', `!!${q('[data-testid=message-file]')}`, 15000);
    await sees('the agent read it', 'Read it: Linden Print asks for payment by the 3rd.');
    const names = (await reader.list({ directory: 'uploads' })).entries.map(entry => entry.path);
    assert.ok(names.some(path => /^uploads\/vendor-note.*\.txt$/.test(path)), `uploaded into the workspace: ${names}`);
    await browser.screenshot('4d-attachment-card.png');
  });

  await step('d the agent writes tt.md (observed, no receipt) and opens it; the Library lists it live', async () => {
    const before = app.navigation.length;
    await say('Can you create a new file tt.md and open it?');
    await sees('the answer', 'I created tt.md in the workspace and opened it in the viewer.');
    await browser.until('tt.md open in the right column', `${viewing} === 'tt.md' && ${q('[data-testid=library-document]')}?.dataset.path === 'tt.md'`, 15000);
    await browser.until('its text', `${q('[data-testid=library-document]')}.innerText.includes('INV-2043 duplicates INV-2041')`, 15000);
    assert.equal(app.navigation.length, before + 1);
    const versions = await reader.history('tt.md');
    assert.ok(versions.length >= 1 && versions.every(version => version.source === 'agent'), `history entries are the agent's: ${JSON.stringify(versions)}`);
    assert.equal((await app.ap.read('INV-2043')).status, 'pending', 'a file write is not an invoice decision');
    await library();
    await browser.until('tt.md in the tree', `!!${q('[role=treeitem][data-path="tt.md"]')}`, 15000);
    await browser.screenshot('4e-agent-file.png');
    await browser.press('Escape');
    await browser.until('the Library closed', `!${q('[data-testid=library-popover]')}`, 5000);
    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.until('back on the queue', `${viewing} === 'Approvals'`, 5000);
  });

  await step('5 dragging the divider floats the chat: placement floating, the sessions pane goes, the app takes the full width', async () => {
    const divider = await browser.evaluate(rect('[data-testid=dock-divider-chat]'));
    const from = { x: divider.x + divider.w / 2, y: divider.y + divider.h / 2 };
    await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (150 - from.x) * i / 8, from.y);
    await browser.until('the hint', `!!${q('[data-testid=dock-hint-chat]')}`, 3000);
    await mouse('mouseReleased', 150, from.y);
    await browser.until('floating, as AmbientChat', `${placement} === 'floating' && !!${q('[data-boring=ambient-chat]')} && !${q('[data-boring=pi-chat]')}`, 10000);
    assert.ok(await browser.evaluate(`!!${q('[data-testid=ambient-action-history]')} && !!${q('[data-testid=ambient-action-library]')}`), 'the history and Library icons live in the floating chat header too');
    const main = await browser.evaluate(rect('[data-boring=dock-main]'));
    assert.ok(main.x < 2 && Math.round(main.w) === 1500, `the right column takes the full width: ${JSON.stringify(main)}`);
    await pause(400);
    await browser.screenshot('6-floating.png');
  });

  await step('6 floating, on the supplier page: a short answer and the page stays where it is', async () => {
    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.click(q('[data-testid=queue-row-INV-2043]'));
    await browser.until('INV-2043 open', `${viewing} === 'Invoice INV-2043'`, 10000);
    await browser.click(q('[data-testid=open-supplier]'));
    await browser.until('the supplier page', `${viewing} === 'Supplier linden-print' && !!${q('[data-testid=supplier-flag]')}`, 10000);
    const moves = app.navigation.length;
    await say('Why is this flagged?');
    await sees('the short answer', 'Linden Print Co sent two invoices, INV-2041 and INV-2043, for the same PO and amount.');
    assert.equal(lastContext().placement, 'floating');
    assert.deepEqual(screenOf(lastContext()), { name: 'Supplier', params: { id: 'linden-print' } });
    assert.equal(app.navigation.length, moves, 'the agent did not move the page');
    assert.equal(await browser.evaluate(viewing), 'Supplier linden-print');
    // The Library icon works from the floating chat too: the popover sits over the chat and a pick opens the document in the right column.
    await library();
    const popover = await browser.evaluate(rect('[data-testid=library-popover]')), floatingChat = await browser.evaluate(rect('[data-boring=ambient-chat]'));
    assert.ok(popover.x >= floatingChat.x - 1 && popover.right <= floatingChat.right + 1, `anchored to the chat: ${JSON.stringify([popover, floatingChat])}`);
    await browser.press('Escape');
    await browser.until('the Library closed', `!${q('[data-testid=library-popover]')}`, 5000);
    await pause(300);
    await browser.screenshot('7-supplier.png');
  });

  await step('7 docking back restores the chat column; the conversation is intact and goes on', async () => {
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked again', `${placement} === 'docked' && !!${q('[data-boring=pi-chat]')}`, 10000);
    for (const text of ['I opened the queue in the viewer.', 'INV-2043 looks like a duplicate of INV-2041', 'Receipt decide-', 'Linden Print Co sent two invoices']) await sees(`still there: ${text}`, text, 10000);
    assert.equal(await browser.evaluate(viewing), 'Supplier linden-print', 'the right column stayed on the supplier page');
    await say('Thanks, that is all for today.');
    await sees('the conversation goes on', 'INV-2044 from North Quay is the one left in the queue.');
    assert.equal(lastContext().placement, 'docked');
    await browser.screenshot('8-docked-again.png');
  });

  await step('agent commands are bound to their conversation and tab: a late or foreign command does not move the viewer', async () => {
    const tab = lastContext().tab, earlier = app.earlier[0];
    assert.ok(app.navigation.every(item => item.conversation === app.current && item.tab === tab), 'every command so far was addressed to this conversation and tab');
    const where = await browser.evaluate(viewing);
    await openConversation('Month-end close');
    await sees('the other conversation is open', 'Left in the close: accruals for March');
    // A slow result of the first conversation arrives while the second is open; another tab's command for the second one arrives too.
    app.navigate({ conversation: app.current, tab, screen: 'supplier', id: 'north-quay' });
    app.navigate({ conversation: earlier, tab: 'another-tab', screen: 'supplier', id: 'north-quay' });
    await pause(1500);
    assert.equal(await browser.evaluate(viewing), where, 'neither command moved the viewer');
    await openConversation("This week's approvals");
    await sees('back in the first conversation', 'I opened the queue in the viewer.');
    await pause(1500);
    assert.equal(await browser.evaluate(viewing), where, 'the stale command was dropped, not delivered on return');
    app.navigate({ conversation: app.current, tab, screen: 'approvals' });
    await browser.until('a command for this conversation and tab is applied', `${viewing} === 'Approvals'`, 5000);
  });

  assert.deepEqual(app.contexts.map(item => item.value.placement), ['docked', 'docked', 'docked', 'docked', 'docked', 'docked', 'docked', 'floating', 'docked']);
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log(`workspace-demo journey passed. Screenshots in ${evidence}`);
} finally {
  await browser?.close();
  await app.close();
}
