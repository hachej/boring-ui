// Real-browser journey for the workspace demo (scripted model, no key): one person, one accounts-payable week, a dozen moments.
//   1  chat docked: "what needs my approval this week?" and the agent opens the Approvals queue in the viewer
//   2  the person opens an invoice (PDF and extracted fields)
//   a  the history icon in the chat header lists earlier conversations (a search field with an Archived icon toggle); switching keeps each transcript
//   3  the person clicks another invoice; the agent sees it (screen context) and spots a duplicate
//   b  the Library icon in the chat header opens the file list; the AP policy opened from it lands in the agent's own viewer beside the chat (the agent area widens; the app column shows no document); the viewer closes with a guard for unsaved edits; "does this invoice respect the policy?" is answered from the document and the invoice
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
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
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
  const shot = name => browser.screenshot(name);
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
    await browser.until('the policy in the agent viewer', `${q('[data-testid=library-document]')}?.dataset.path === 'Policies/AP policy.md'`, 15000);
    // The file lives in the agent area, beside the chat (the dock widened); the app column shows no document and stays on its screen.
    const placed = await browser.evaluate(`({ inDock: !!${q('[data-dock=chat] [data-testid=library-document]')}, inApp: !!${q('[data-testid=right-column] [data-testid=library-document]')}, chat: ${rect('[data-boring=pi-chat]')}, doc: ${rect('[data-testid=library-document]')}, dock: ${rect('[data-dock=chat]')} })`);
    assert.ok(placed.inDock && !placed.inApp, `the document is in the agent area, not the app: ${JSON.stringify(placed)}`);
    assert.ok(placed.doc.x >= placed.chat.right - 2 && placed.dock.w > 760, `beside the chat, in a widened agent area: ${JSON.stringify(placed)}`);
    assert.equal(await browser.evaluate(viewing), 'Invoice INV-2043', 'the app did not move');
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
    await browser.click(q('[data-testid=library-document] [data-testid=viewer-close]'));
    await pause(300);
    assert.equal(await browser.evaluate('window.__asked'), 1, 'leaving asked once');
    assert.equal(await browser.evaluate(`${q('[data-testid=library-document]')}?.dataset.path`), 'Policies/AP policy.md', 'declining stays on the document');
    assert.ok((await browser.evaluate(`${q('[data-testid=library-document] textarea.boring-markdown-source')}.value`)).includes('Draft edit.'), 'the edit is still there');
    await browser.evaluate(`window.confirm = () => true`);
    await browser.click(q('[data-testid=library-document] [data-testid=viewer-close]'));
    await browser.until('the viewer closed, the agent area is narrow again', `!${q('[data-testid=library-document]')} && ${rect('[data-dock=chat]')}.w < 800`, 5000);
    await browser.click(q('[data-testid=nav-approvals]'));
    await browser.until('Approvals', `${viewing} === 'Approvals'`, 5000);
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
    const before = app.navigation.length, appWas = await browser.evaluate(viewing);
    await say('Can you create a new file tt.md and open it?');
    await sees('the answer', 'I created tt.md in the workspace and opened it in the viewer.');
    await browser.until('tt.md open in the agent viewer', `${q('[data-dock=chat] [data-testid=library-document]')}?.dataset.path === 'tt.md'`, 15000);
    assert.ok(!(await browser.evaluate(`!!${q('[data-testid=right-column] [data-testid=library-document]')}`)), 'not in the app column');
    assert.equal(await browser.evaluate(viewing), appWas, 'the app stayed where it was');
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
    await browser.click(q('[data-testid=library-document] [data-testid=viewer-close]'));
    await browser.until('the viewer closed', `!${q('[data-testid=library-document]')}`, 5000);
  });

  await step('d2 the Library stays open while the agent writes: it updates live, the change event is the agent\'s and no receipt is minted', async () => {
    const stop = new AbortController(), events = [];
    void (async () => { try { for await (const event of reader.changes({ signal: stop.signal })) events.push(event); } catch { /* stopped */ } })();
    await library();
    await browser.until('the search field has focus', `document.activeElement?.type === 'search' && !!document.activeElement.closest('[data-testid=library-popover]')`, 10000);
    await browser.until('the tree is listed', `!!${q('[role=treeitem][data-path="Policies"]')}`, 15000);
    assert.ok(!(await browser.evaluate(`!!${q('[role=treeitem][data-path="live.md"]')}`)), 'live.md does not exist yet');
    const receipts = app.publications();
    const conversation = await app.conversations.open('ap-helper', Number(app.current));
    await (await conversation.submit({ type: 'input', requestId: 'journey-live-note', content: 'Please write the live note.' }, context)).wait(context);
    await browser.until('live.md appears in the open Library', `!!${q('[data-testid=library-popover] [role=treeitem][data-path="live.md"]')}`, 15000);
    assert.equal(app.publications(), receipts, 'the publication journal is unchanged after the agent write');
    for (let i = 0; i < 50 && !events.some(event => event.path === 'live.md'); i++) await pause(100);
    assert.ok(events.some(event => event.path === 'live.md' && event.source === 'agent'), `an agent change event for live.md: ${JSON.stringify(events)}`);
    assert.ok((await reader.history('live.md')).every(version => version.source === 'agent'), 'history says agent');
    await browser.screenshot('4f-library-live.png');
    // Escape closes the Library only (the chat is not collapsed) and focus goes back to the icon that opened it.
    await browser.press('Escape');
    await browser.until('the Library closed, focus on its icon', `!${q('[data-testid=library-popover]')} && document.activeElement?.dataset.testid === 'chat-action-library'`, 5000);
    stop.abort();
  });

  await step('d3 docked, a PDF opens as an inset card inside the agent panel (a column of the chat, no hard divider) and closing gives the width back', async () => {
    const before = (await browser.evaluate(rect('[data-dock=chat]'))).w;
    await library();
    await browser.click(q('[role=treeitem][data-path="Contracts"]'));
    await browser.until('the contract in the tree', `!!${q('[role=treeitem][data-path="Contracts/fernhill-agreement.pdf"]')}`, 15000);
    await browser.click(q('[role=treeitem][data-path="Contracts/fernhill-agreement.pdf"]'));
    await browser.until('the PDF in the agent panel', `${q('[data-dock=chat] [data-testid=library-document]')}?.dataset.path === 'Contracts/fernhill-agreement.pdf'`, 15000);
    await pause(500);
    const card = await browser.evaluate(`(() => { const panel = document.querySelector('[data-testid=workspace-panel]'), dock = document.querySelector('[data-dock=chat]').getBoundingClientRect(), chat = document.querySelector('[data-boring=pi-chat]').getBoundingClientRect(), r = panel.getBoundingClientRect(), style = getComputedStyle(panel);
      return { top: r.top - dock.top, bottom: dock.bottom - r.bottom, right: dock.right - r.right, gap: r.left - chat.right, radius: parseFloat(style.borderTopLeftRadius), borderLeft: parseFloat(style.borderLeftWidth), divider: getComputedStyle(document.querySelector('[data-testid=workspace-divider] span')).backgroundColor }; })()`);
    assert.ok(card.top >= 4 && card.bottom >= 4 && card.right >= 4 && card.radius >= 8, `an inset rounded card inside the panel: ${JSON.stringify(card)}`);
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(card.divider), `no visible divider between the chat and the card: ${card.divider}`);
    await shot('9-docked-pdf.png');
    await browser.click(q('[data-testid=library-document] [data-testid=viewer-close]'));
    await browser.until('closed: the width is back', `!${q('[data-testid=library-document]')} && Math.abs(${rect('[data-dock=chat]')}.w - ${before}) < 2`, 5000);
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
    // A pick opens the file IN PLACE of the floating chat (same window, a back button); back returns to the conversation.
    await browser.click(q('[role=treeitem][data-path="Policies"]'));
    await browser.until('the policy in the tree', `!!${q('[role=treeitem][data-path="Policies/AP policy.md"]')}`, 15000);
    await browser.click(q('[role=treeitem][data-path="Policies/AP policy.md"]'));
    await browser.until('the viewer replaces the floating chat', `!!${q('[data-testid=floating-viewer] [data-testid=library-document]')} && !${q('[data-boring=ambient-chat]')}`, 15000);
    assert.equal(await browser.evaluate(viewing), 'Supplier linden-print', 'the app did not move');
    assert.ok(await browser.evaluate(`!${q('[data-testid=right-column] [data-testid=library-document]')}`), 'not in the app column');
    await pause(400);
    await browser.screenshot('7a-floating-file.png');
    await browser.click(q('[data-testid=file-back]'));
    await browser.until('the conversation is back', `!!${q('[data-boring=ambient-chat]')} && !${q('[data-testid=floating-viewer]')}`, 10000);
    // From the collapsed bar (about 48px high) the Library opens above it, inside the viewport, and stays usable.
    await browser.click(q('[data-testid=ambient-minimize]'));
    await browser.until('the collapsed bar', `${q('[data-boring=ambient-chat]')}?.dataset.state === 'bar'`, 5000);
    await library();
    await browser.until('a usable tree', `!!${q('[data-testid=library-popover] [role=treeitem]')}`, 10000);
    const bar = await browser.evaluate(rect('[data-boring=ambient-chat]')), above = await browser.evaluate(rect('[data-testid=library-popover]'));
    assert.ok(above.y >= 0 && above.y + above.h <= bar.y + 2 && above.h > 150, `the Library opens above the collapsed bar: ${JSON.stringify({ bar, above })}`);
    await browser.press('Escape');
    await browser.until('closed, and the bar was not collapsed further', `!${q('[data-testid=library-popover]')} && ${q('[data-boring=ambient-chat]')}?.dataset.state === 'bar'`, 5000);
    await browser.click(q('[data-testid=ambient-title]'));
    await browser.until('expanded again', `${q('[data-boring=ambient-chat]')}?.dataset.state === 'expanded'`, 5000);
    await pause(300);
    await browser.screenshot('7-supplier.png');
  });

  await step('6b a PDF opened while the chat floats stays inside the viewport (1440x900 and 1280x720), with the header pinned and one scroll container', async () => {
    const inside = `(() => { const box = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.width > 0; };
      const win = document.querySelector('[data-testid=floating-viewer]');
      return { back: box('[data-testid=floating-viewer] [data-testid=file-back]'), close: box('[data-testid=floating-viewer] [data-testid=viewer-close]'), window: box('[data-testid=floating-viewer]'),
        pageOverflow: document.documentElement.scrollWidth > innerWidth, windowOverflow: win.scrollWidth > win.clientWidth, windowTop: win.getBoundingClientRect().top }; })()`;
    for (const [width, height] of [[1440, 900], [1280, 720]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      // The chat was dragged near the top earlier in the session: the window must still come up whole (its remembered corner is clamped).
      await browser.evaluate(`sessionStorage.setItem('boring.ambient.position', JSON.stringify({ right: 40, bottom: 520 }))`);
      await library();
      await browser.click(q('[role=treeitem][data-path="Contracts"]'));
      await browser.until('the contract in the tree', `!!${q('[role=treeitem][data-path="Contracts/fernhill-agreement.pdf"]')}`, 15000);
      await browser.click(q('[role=treeitem][data-path="Contracts/fernhill-agreement.pdf"]'));
      await browser.until('the PDF replaces the floating chat', `!!${q('[data-testid=floating-viewer] [data-testid=library-document]')} && !${q('[data-boring=ambient-chat]')}`, 15000);
      await pause(500);
      await browser.screenshot(`8-floating-pdf-${width}x${height}.png`);
      const state = await browser.evaluate(inside);
      assert.deepEqual([state.back, state.close, state.window, state.pageOverflow, state.windowOverflow], [true, true, true, false, false], `${width}x${height}: ${JSON.stringify(state)}`);
      // It reflows when the window is resized while open.
      await browser.send('Emulation.setDeviceMetricsOverride', { width: width - 200, height: height - 150, deviceScaleFactor: 1, mobile: false });
      await pause(300);
      const resized = await browser.evaluate(inside);
      assert.deepEqual([resized.back, resized.close, resized.window, resized.pageOverflow], [true, true, true, false], `after a resize: ${JSON.stringify(resized)}`);
      await browser.click(q('[data-testid=file-back]'));
      await browser.until('the chat is back', `!!${q('[data-boring=ambient-chat]')} && !${q('[data-testid=floating-viewer]')}`, 10000);
    }
    await browser.send('Emulation.clearDeviceMetricsOverride');
    await browser.evaluate(`sessionStorage.removeItem('boring.ambient.position')`);
  });

  await step('7 docking back restores the chat column; the conversation is intact and goes on', async () => {
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked again', `${placement} === 'docked' && !!${q('[data-boring=pi-chat]')}`, 10000);
    for (const text of ['I opened the queue in the viewer.', 'INV-2043 looks like a duplicate of INV-2041', 'Receipt decide-', 'Linden Print Co sent two invoices']) await sees(`still there: ${text}`, text, 10000);
    assert.equal(await browser.evaluate(viewing), 'Supplier linden-print', 'the app column stayed on the supplier page');
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
    // A file command that bypasses the tool's check (a bad path) never reaches the viewer: the page stays up.
    app.navigate({ conversation: app.current, tab, screen: 'file', path: '../outside.md' });
    await pause(1500);
    assert.ok(await browser.evaluate(`!!${INPUT} && !${q('[data-testid=library-document]')}`), 'the page survived a bad file path');
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
