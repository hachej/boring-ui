// Real-browser journey for the workspace app (scripted model, no key): the page is only the pi-app block over the host handlers of
// ./server.mjs. It proves: the sessions pane lists the chats, search filters them, choosing one changes the chat in the center, an
// artifact the agent presents opens in the panel on the right, the pane collapses right after a switch (the toggle is one button across it), and on a phone (390x844) the sessions are a drawer and
// the artifact a full-screen sheet with no horizontal scroll. Then the same app with `?configured` (labels, one icon and host actions passed as props): the
// custom words and icon replace the defaults, each host action (chat header, its "…" menu by keyboard, a conversation row, a reply, the artifact panel, the
// floating chat's bar) renders, is clickable and reaches the host, "Float chat" is one of the panel's actions, and it all holds at phone width.
// Screenshots go to .cache/evidence/workspace-app/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../../lab/studio/scripted-model.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/workspace-app';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const INPUT = q('[data-testid=composer-input]');
const LOG = `(${q('[data-testid=transcript]')}?.innerText ?? '')`;
const REPLIES = `${qa('[data-testid=transcript] article[data-role=assistant]')}.map(e => e.innerText).join(' ')`;
const ACTIVE = `${q('[data-testid=app]')}.dataset.conversation`;
const ROWS = qa('[data-testid=conversation-row]');
const row = text => `${ROWS}.find(row => row.innerText.includes(${JSON.stringify(text)}))`;
const idle = `${q('[data-testid=composer-submit]')}?.dataset.state === 'send'`;
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const rect = selector => `(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
// The words and icons a host can change, as the page shows them.
const TEXTS = `({ title: ${q('[data-boring=pi-chat] header h2')}?.textContent, placeholder: ${INPUT}?.placeholder, send: ${q('[data-testid=composer-submit]')}?.getAttribute('aria-label'),
  sessions: ${q('[data-testid=conversations] header h2')}?.textContent, newChat: ${q('[data-testid=conversation-new]')}?.textContent, toggle: ${q('[data-testid=sessions-toggle]')}?.getAttribute('aria-label'),
  customIcon: !!${q('[data-testid=composer-submit] [data-testid=custom-send-icon]')}, hostActions: ${qa('[data-boring=block-actions]')}.length })`;
const LOGGED = `(${q('[data-testid=host-log]')}?.textContent ?? '').split(' ')`;
const logged = id => `${LOGGED}.filter(entry => entry === ${JSON.stringify(id)}).length`;
// Elements of the sessions pane that scroll sideways (a scroll container whose content is wider than it), as short descriptions.
const SIDEWAYS = `(() => { const pane = ${q('[data-testid=conversations]')}; return [pane, ...pane.querySelectorAll('*')].filter(e => !e.matches('input')
  && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1).map(e => \`\${e.tagName} \${e.dataset.testid ?? ''} \${e.scrollWidth}>\${e.clientWidth}\`); })()`;
const inside = selector => `(() => { const r = ${q(selector)}?.getBoundingClientRect(); return !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`;

const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-workspace-app-')) });
let browser;
try {
  browser = await launch(insecureUrl(app.url), { evidence });
  const say = async text => { await browser.type(INPUT, text); await browser.press('Enter'); };
  const live = () => browser.until('the chat is live', `!!${INPUT} && !${INPUT}.disabled`, 20000);

  const alignedControls = async () => {
    const layout = await browser.evaluate(`(() => { const row = ${q('[data-testid=composer-controls]')}; if (!row) return null; const boxes = [...row.querySelectorAll('button')].filter(e => e.checkVisibility()).map(e => { const r = e.getBoundingClientRect(); return { centre: r.top + r.height / 2, height: r.height }; }); const text = ${INPUT}.getBoundingClientRect(); return { boxes, textBottom: text.bottom, controlsTop: row.getBoundingClientRect().top }; })()`);
    assert.ok(layout, 'reference composer has a separate controls row');
    assert.ok(layout.boxes.length >= 2);
    assert.ok(Math.max(...layout.boxes.map(box => box.centre)) - Math.min(...layout.boxes.map(box => box.centre)) <= 1, JSON.stringify(layout));
    assert.ok(layout.boxes.every(box => box.height === layout.boxes[0].height && [40, 44].includes(box.height)), JSON.stringify(layout));
    assert.ok(layout.textBottom <= layout.controlsTop + 1, 'text occupies the full-width row above the controls');
  };

  await step('a failed discovery shows an alert, and Retry opens the workspace', async () => {
    await live();
    app.faults.resources = 1;
    await browser.reload();
    await browser.until('the alert with Retry', `!!${q('p[role="alert"] button')}`, 20000);
    assert.match(await browser.evaluate(`${q('p[role="alert"]')}.innerText`), /could not be reached/);
    await browser.click(q('p[role="alert"] button'));
    await live();
    assert.equal(app.faults.resources, 0, 'the refused discovery was the one retried');
  });

  await step('the page is the block: sessions pane, chat, no studio code', async () => {
    await live();
    assert.equal(await browser.evaluate(`${q('[data-boring=agent-workspace]')}.dataset.sessions`), 'docked');
    await browser.until('one chat listed', `${ROWS}.length === 1 && ${ROWS}[0].dataset.active === 'true'`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=sessions-toggle]')}.getAttribute('aria-expanded')`), 'true');
    assert.equal(await browser.evaluate(`${qa('[data-testid=sessions-toggle]')}.filter(e=>e.getBoundingClientRect().width > 0).length`), 1, 'one sidebar toggle');
    assert.equal(await browser.evaluate(`!!${q('[data-testid=connection]')}`), false, 'no default Live badge');
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), true, 'empty send is disabled');
    const composer = await browser.evaluate(rect('[data-testid=composer]'));
    assert.ok(composer.y > 250 && composer.y < 650, 'empty desktop composer is centered');
    await browser.screenshot('standalone-empty-desktop.png');
  });

  await step('defaults: without labels, icons or actions the blocks show their own words and no host actions', async () => {
    assert.deepEqual(await browser.evaluate(TEXTS), { title: 'Writer', placeholder: 'Message Writer…', send: 'Send', sessions: 'Writer', newChat: 'New chat', toggle: 'Hide navigation', customIcon: false, hostActions: 0 });
  });

  const first = await browser.evaluate(ACTIVE);
  await step('a reply in the first chat', async () => {
    await say('Reply with exactly: AMBER-HARBOUR');
    await browser.until('the reply', `/AMBER-HARBOUR/.test(${REPLIES}) && ${idle}`, 20000);
    const composer = await browser.evaluate(rect('[data-testid=composer]'));
    assert.ok(composer.y > 700, 'composer docks after the first message');
  });

  await step('reference composer: empty and one-line controls share a centre; files chip is absent', async () => {
    await alignedControls();
    assert.equal(await browser.evaluate(`!!${q('[data-testid=conversation-files]')}`), false);
    await browser.type(INPUT, 'A fictional unsent line');
    await alignedControls();
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), false);
    await browser.evaluate(`${INPUT}.focus(); ${INPUT}.select()`); await browser.press('Backspace');
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.disabled`), true);
  });

  await step('clicking the conversation title renames the same server-owned conversation', async () => {
    for (const title of ['Amber notebook', 'Reply with exactly: AMBER-HARBOUR']) {
      await browser.click(q('[data-boring=pi-chat] > header h2 button'));
      await browser.until('title editor', `!!${q('[data-boring=pi-chat] > header input[name=title]')}`, 5000);
      await browser.evaluate(`${q('[data-boring=pi-chat] > header input[name=title]')}.select()`);
      await browser.press('Backspace');
      await browser.type(q('[data-boring=pi-chat] > header input[name=title]'), title);
      await browser.press('Enter');
      await browser.until('title and sidebar agree', `${q('[data-boring=pi-chat] > header h2')}?.textContent === ${JSON.stringify(title)} && ${q('[data-testid=conversation-row][data-active=true]')}.innerText.includes(${JSON.stringify(title)})`, 10000);
      assert.equal(await browser.evaluate(ACTIVE), first, 'rename does not replace the conversation');
    }
  });

  let second;
  await step('New in the sessions pane starts an empty chat in the center', async () => {
    await browser.click(q('[data-testid=conversation-new]'));
    await browser.until('a second chat is open', `${ACTIVE} !== ${JSON.stringify(first)} && ${LOG}.trim() === ''`, 20000);
    await live();
    second = await browser.evaluate(ACTIVE);
  });

  await step('an artifact the agent presents opens in the panel on the right', async () => {
    await say('Write a picnic plan and present it.');
    await browser.until('the artifact panel', `${q('[data-testid=artifact-panel]')}?.dataset.artifactType === 'markdown' && /Picnic plan/.test(${q('[data-testid=artifact-panel]')}.innerText)`, 30000);
    await browser.until('the card and the reply', `!!${q('[data-testid=artifact-card]')} && /ready/.test(${LOG}) && ${idle}`, 20000);
    const panel = await browser.evaluate(rect('[data-testid=workspace-panel]'));
    const sessions = await browser.evaluate(rect('[data-testid=conversations]'));
    assert.ok(sessions.x < 2 && panel.x + panel.w > 1400, `sessions on the left, panel on the right: ${JSON.stringify({ sessions, panel })}`);
    await pause(300);
    await browser.screenshot('workspace-app-desktop.png');
  });

  await step('the artifacts chip counts the file and opens its desktop list', async () => {
    await browser.until('conversation file exists', `${q('[data-testid=conversation-files]')}?.textContent.includes('1')`, 5000);
    await browser.click(q('[data-testid=conversation-files]'));
    await browser.until('conversation files popover', `${q('[data-testid=conversation-files-list]')}?.innerText.includes('picnic-plan.md')`, 5000);
    await browser.click(q('[data-testid=conversation-file]'));
    await browser.until('file opens and list closes', `!!${q('[data-testid=artifact-panel]')} && !${q('[data-testid=conversation-files-list]')}`, 5000);
  });

  await step('an uploaded file joins the conversation files list beside its generated artifact', async () => {
    const upload = join(mkdtempSync(join(tmpdir(), 'fictional-composer-upload-')), 'fictional-notes.txt');
    writeFileSync(upload, 'Fictional notes for the picnic.\n');
    await browser.attachFiles(q('[data-testid=composer-file]'), [upload]);
    await browser.until('uploaded file counted', `${q('[data-testid=conversation-files]')}?.textContent.includes('2')`, 10000);
    await browser.click(q('[data-testid=conversation-files]'));
    await browser.until('uploaded and generated files listed', `${q('[data-testid=conversation-files-list]')}?.innerText.includes('fictional-notes.txt') && ${q('[data-testid=conversation-files-list]')}.innerText.includes('picnic-plan.md')`, 5000);
    await browser.press('Escape');
    await browser.until('files list closed', `!${q('[data-testid=conversation-files-list]')}`, 5000);
    await browser.evaluate(`${INPUT}.focus(); ${INPUT}.select()`); await browser.press('Backspace');
  });

  await step('opening an artifact resizes an existing draft without clipping its wrapped lines', async () => {
    await browser.press('Escape');
    await browser.until('wide chat', `!${q('[data-testid=workspace-panel]')}`, 5000);
    const draft = 'A fictional draft stays visible when the artifact opens beside this conversation.';
    await browser.type(q('[data-testid=composer-input]'), draft);
    await browser.click(q('[data-testid=artifact-card]'));
    await browser.until('draft resized without clipping', `!!${q('[data-testid=workspace-panel]')} && ${q('[data-testid=composer-input]')}.scrollHeight <= ${q('[data-testid=composer-input]')}.clientHeight + 1`, 5000);
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-input]')}.value`), draft);
    await browser.screenshot('workspace-app-draft-resize.png');
    await browser.evaluate(`${q('[data-testid=composer-input]')}.focus(); ${q('[data-testid=composer-input]')}.select()`);
    await browser.press('Backspace');
  });

  await step('the sessions pane lists both chats by their first message, and search filters them', async () => {
    await browser.until('both chats titled', `!!${row('AMBER-HARBOUR')} && !!${row('picnic plan')}`, 15000);
    await browser.click(q('[data-testid=conversation-search-open]'));
    await browser.type(q('[data-testid=conversation-search]'), 'amber');
    await browser.until('only the first chat', `${ROWS}.length === 1 && /AMBER/.test(${ROWS}[0].innerText)`, 10000);
    await browser.screenshot('workspace-app-search.png');
    await browser.evaluate(`(() => { const e = ${q('[data-testid=conversation-search]')}; e.focus(); e.select(); })()`);
    await browser.press('Backspace');
    await browser.until('both again', `${ROWS}.length === 2`, 10000);
  });

  await step('choosing a chat changes the center; the artifact panel belongs to its chat', async () => {
    await browser.click(row('AMBER-HARBOUR'));
    await browser.until('the first chat', `${ACTIVE} === ${JSON.stringify(first)} && /AMBER-HARBOUR/.test(${LOG}) && !/picnic/i.test(${LOG})`, 20000);
    assert.equal(await browser.evaluate(`!${q('[data-testid=artifact-panel]')}`), true, 'the other chat\'s artifact is not shown');
    assert.equal(await browser.evaluate(`${q('[data-testid=conversation-row][data-active=true]')}.dataset.conversationId`), first);
    // The sessions toggle is one button for the page's life: the chat header is replaced on a switch (connecting, then the new chat), the
    // toggle is not, so a press during the swap still clicks.
    assert.equal(await browser.evaluate(`${qa('[data-testid=sessions-toggle]')}.filter(e=>e.getBoundingClientRect().width>0).length`), 1);
    await browser.click(row('picnic plan'));
    await browser.until('back to the second chat with its artifact', `${ACTIVE} === ${JSON.stringify(second)} && !!${q('[data-testid=artifact-panel]')}`, 20000);
  });

  await step('the sessions pane collapses and comes back, right after a switch', async () => {
    // No wait for the chat to be live: the toggle works while the chat connects.
    await browser.click(q('[data-testid=sessions-toggle]'));
    await browser.until('hidden', `!${q('[data-testid=conversations]')} && ${q('[data-boring=agent-workspace]')}.dataset.sessions === 'hidden'`, 5000);
    await browser.click(q('[data-testid=sessions-toggle]'));
    await browser.until('shown', `!!${q('[data-testid=conversations]')}`, 5000);
    await live();
    assert.equal(await browser.evaluate(`${qa('[data-testid=sessions-toggle]')}.filter(e=>e.getBoundingClientRect().width>0).length`), 1, 'no duplicate toggle after switching');
  });

  await step('phone: sessions are a drawer, the artifact a full-screen sheet, no horizontal scroll', async () => {
    await browser.emulate('phone');
    await browser.until('narrow layout', `${q('[data-boring=agent-workspace]')}.dataset.sessions === 'closed' && innerWidth === 390`, 10000);
    const sheet = async name => {
      await browser.until('the sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && !!${q('[data-testid=artifact-panel]')}`, 10000);
      await pause(400);
      assert.deepEqual(await browser.evaluate(`(() => { const r = ${q('[data-testid=workspace-panel]')}.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`), { w: 390, h: 844 }, 'full screen');
      assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the sheet');
      const bar = await browser.evaluate(rect('[data-testid=artifact-bar]'));
      assert.ok(bar.h <= 56, 'single row artifact header');
      assert.ok(await browser.evaluate(inside('[data-testid=artifact-close]')) && await browser.evaluate(inside('[data-testid=artifact-more]')), 'back and menu inside viewport');
      await browser.screenshot(name);
      await browser.tap(q('[data-testid=artifact-close]'));
      await browser.until('the sheet closed', `!${q('[data-testid=artifact-panel]')}`, 5000);
    };
    // The panel open on the desktop is a full-screen sheet now.
    await sheet('workspace-app-phone-artifact.png');
    await pause(300);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll on the chat');
    await alignedControls();
    await browser.click(q('[data-testid=conversation-files]'));
    await browser.until('conversation files phone sheet', `!!${q('[data-testid=conversation-files-list]')} && ${q('[data-testid=conversation-files-list]')}.getBoundingClientRect().width <= innerWidth`, 5000);
    assert.match(await browser.evaluate(`${q('[data-testid=conversation-files-list]')}.innerText`), /picnic-plan.md/);
    await browser.press('Escape');
    await browser.until('conversation files sheet closed', `!${q('[data-testid=conversation-files-list]')}`, 5000);
    await browser.screenshot('workspace-app-phone-chat.png');
    await browser.tap(q('[data-testid=sessions-toggle]'));
    await browser.until('the drawer', `${q('[data-testid=conversations]')}?.dataset.drawer === 'true'`, 5000);
    await pause(300);
    const drawer = await browser.evaluate(rect('[data-testid=conversations]'));
    assert.ok(drawer.x === 0 && drawer.w <= 390 && drawer.h === 844, `drawer inside the screen: ${JSON.stringify(drawer)}`);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the drawer');
    await browser.screenshot('workspace-app-phone-drawer.png');
    await browser.tap(row('AMBER-HARBOUR'));
    await browser.until('drawer closed on the first chat', `!${q('[data-testid=conversations]')} && ${ACTIVE} === ${JSON.stringify(first)} && /AMBER-HARBOUR/.test(${REPLIES})`, 15000);
    await browser.tap(q('[data-testid=sessions-toggle]'));
    await browser.tap(row('picnic plan'));
    await browser.until('the second chat', `${ACTIVE} === ${JSON.stringify(second)} && !!${q('[data-testid=artifact-card]')}`, 20000);
    // A card opens the artifact as a sheet on a phone.
    await browser.tap(q('[data-testid=artifact-card]'));
    await sheet('workspace-app-phone-artifact-card.png');
    await browser.emulate('desktop');
  });

  await step('360px: artifact has only back, title and menu; Escape and Back restore chat focus; Library is a bottom sheet', async () => {
    await browser.emulate('phone');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
    await browser.tap(q('[data-testid=artifact-card]'));
    await browser.until('artifact sheet at 360', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true'`, 5000);
    assert.equal(await browser.evaluate(`${qa('[data-testid=artifact-bar] button')}.filter(e=>e.checkVisibility()).length`), 2, 'only Back and overflow beside title');
    assert.ok(await browser.evaluate(noOverflow));
    await browser.tap(q('[data-testid=artifact-more]'));
    await browser.until('phone artifact menu', `!!${q('[data-testid=artifact-more-list]')}`, 5000);
    await browser.tap(q('[data-testid=artifact-more-list] [data-testid=artifact-mode-source]'));
    await browser.until('source editing available from overflow', `${q('[data-boring=markdown-editor]')}?.dataset.mode === 'source'`, 5000);
    await browser.press('Escape');
    assert.ok(await browser.evaluate(`!!${q('[data-testid=artifact-panel]')}`), 'Escape first closes the menu, not the file');
    await browser.press('Escape');
    await browser.until('Escape returns to chat', `!${q('[data-testid=artifact-panel]')}`, 5000);
    assert.ok(await browser.evaluate(`document.activeElement?.matches('[data-testid=artifact-card], [data-testid=composer-input]')`), 'focus restored');
    const scroll = await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`);
    await browser.tap(q('[data-testid=artifact-card]'));
    await browser.until('reopened', `!!${q('[data-testid=artifact-panel]')}`, 5000);
    await browser.evaluate('history.back()');
    await browser.until('Back closes only the artifact', `!${q('[data-testid=artifact-panel]')}`, 5000);
    assert.equal(await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`), scroll, 'chat scroll is unchanged');
    await browser.tap(q('[data-testid=sessions-toggle]'));
    await browser.until('phone navigation', `!!${q('[data-testid=conversations]')}`, 5000);
    await browser.tap(q('[data-testid=workspace-library]'));
    await browser.until('Library bottom sheet', `!!${q('[data-slot=drawer-popup] [data-testid=workspace-library-side]')}`, 5000);
    const sheet = await browser.evaluate(rect('[data-slot=drawer-popup]'));
    assert.ok(sheet.y > 0 && sheet.y + sheet.h <= 781 && sheet.w <= 360, 'native bottom-sheet geometry');
    assert.ok(await browser.evaluate(noOverflow));
    await browser.screenshot('standalone-library-360.png');
    await browser.press('Escape');
    await browser.emulate('desktop');
  });

  // ---- The same app, configured through the blocks' props only.
  await step('configured: custom labels and one custom icon replace the defaults', async () => {
    await browser.evaluate(`location.search = '?configured'`);
    await browser.until('the configured page, live', `${q('[data-testid=app]')}?.dataset.configured === 'true' && !!${INPUT} && !${INPUT}.disabled`, 20000);
    await browser.until('the reply of the open chat', `${idle} && !!${q('[data-testid=reply-action-quote]')}`, 20000);
    const texts = await browser.evaluate(TEXTS);
    assert.equal(texts.title, await browser.evaluate(`${q('[data-testid=conversation-row][data-active=true] > span')}.textContent`), 'header uses the current conversation title');
    assert.deepEqual({ ...texts, hostActions: undefined }, { title: texts.title, placeholder: 'Ask Fernhill anything…', send: 'Ask', sessions: 'Projects', newChat: 'Start', toggle: 'Hide navigation', customIcon: true, hostActions: undefined });
    assert.equal(await browser.evaluate(`${q('[data-testid=composer-submit]')}.title`), 'Send (Enter)', 'a label the host did not set keeps its default');
    await browser.screenshot('workspace-app-configured.png');
  });

  await step('configured: a header action is a button, a menu action is reached by keyboard', async () => {
    assert.equal(await browser.evaluate(`${q('[data-testid=chat-action-export]')}.getAttribute('aria-label')`), 'Export chat', 'icon button named by its label');
    await browser.click(q('[data-testid=chat-action-export]'));
    await browser.until('the host got export', `${logged('export')} === 1`, 5000);
    await browser.evaluate(`${q('[data-testid=chat-action-more]')}.focus()`);
    await browser.press('Enter');
    await browser.until('the menu, its item focused', `document.activeElement === ${q('[data-testid=chat-action-report]')}`, 5000);
    await browser.press('Enter');
    await browser.until('the host got report, the menu closed', `${logged('report')} === 1 && !${q('[data-testid=chat-action-report]')}`, 5000);
  });

  await step('configured: actions on a conversation row and on a reply', async () => {
    const ACTIONS = '[data-testid=conversation-row][data-active=true] ~ [data-testid=conversation-actions]';
    await browser.click(q(`${ACTIONS} [data-testid=conversation-action-more]`));
    await browser.click(q('[data-testid=conversation-action-star]'));
    await browser.until('the host got star', `${logged('star')} === 1`, 5000);
    // A row action without an icon lives in the row's "…" menu, so the pane never scrolls sideways.
    await browser.click(q(`${ACTIONS} [data-testid=conversation-action-more]`));
    await browser.click(q('[data-testid=conversation-action-share]'));
    await browser.until('the host got share', `${logged('share')} === 1`, 5000);
    assert.deepEqual(await browser.evaluate(SIDEWAYS), [], 'nothing in the sessions pane scrolls sideways');
    await browser.click(q('[data-testid=reply-action-quote]'));
    await browser.until('the host got quote', `${logged('quote')} === 1`, 5000);
  });

  await step('configured: a panel action, and Float chat is one of the panel\'s actions; the floating bar has the dock action', async () => {
    await browser.click(q('[data-testid=artifact-card]'));
    await browser.until('the panel', `!!${q('[data-testid=artifact-panel]')} && !!${q('[data-testid=artifact-pin]')}`, 10000);
    await browser.click(q('[data-testid=artifact-pin]'));
    await browser.until('the host got pin', `${logged('pin')} === 1`, 5000);
    await browser.click(q('[data-testid=artifact-more]'));
    await browser.until('the renamed Float chat item', `${q('[data-testid=artifact-float-chat]')}?.textContent === 'Pop out chat'`, 5000);
    await browser.click(q('[data-testid=artifact-float-chat]'));
    await browser.until('the floating chat with the dock action', `!!${q('[data-boring=ambient-chat]')} && !!${q('[data-testid=ambient-action-handoff]')}`, 10000);
    await pause(300);
    await browser.screenshot('workspace-app-configured-floating.png');
    await browser.click(q('[data-testid=ambient-action-handoff]'));
    await browser.until('the host got handoff', `${logged('handoff')} === 1`, 5000);
    await browser.click(q('[data-testid=ambient-dock]'));
    await browser.until('docked again', `!${q('[data-boring=ambient-chat]')} && !!${q('[data-boring=pi-chat]')}`, 10000);
    await browser.click(q('[data-testid=artifact-close]'));
    await browser.until('the panel closed', `!${q('[data-testid=artifact-panel]')}`, 5000);
  });

  await step('configured, phone: the custom words and the header actions fit, and a tap reaches the host', async () => {
    await browser.emulate('phone');
    await browser.until('narrow layout', `innerWidth === 390 && ${q('[data-boring=agent-workspace]')}.dataset.sessions === 'closed'`, 10000);
    await pause(300);
    assert.ok(await browser.evaluate(inside('[data-testid=chat-action-export]')), 'the header action is on screen');
    assert.ok(await browser.evaluate(inside('[data-testid=chat-action-more]')), 'the menu button is on screen');
    assert.equal(await browser.evaluate(`${INPUT}.placeholder`), 'Ask Fernhill anything…');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll');
    await browser.screenshot('workspace-app-configured-phone.png');
    await browser.tap(q('[data-testid=chat-action-export]'));
    await browser.until('the host got export again', `${logged('export')} === 2`, 5000);
    await browser.emulate('desktop');
  });

  assert.deepEqual(misses, [], 'every prompt had a scripted answer');
  assert.deepEqual(browser.problems, [], 'no page errors');
  console.log(`PASS workspace-app journey; screenshots in ${evidence}`);
} finally {
  await browser?.close();
  await app.close();
}
