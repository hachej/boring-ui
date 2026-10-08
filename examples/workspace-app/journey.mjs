// Real-browser journey for the workspace app (scripted model, no key): the page is only the pi-app block over the host handlers of
// ./server.mjs. It proves: the sessions pane lists the chats, search filters them, choosing one changes the chat in the center, an
// artifact the agent presents opens in the panel on the right, the pane collapses right after a switch (the toggle is one button across it), and on a phone (390x844) the sessions are a drawer and
// the artifact a full-screen sheet with no horizontal scroll. Then the same app with `?configured` (labels, one icon and host actions passed as props): the
// custom words and icon replace the defaults, each host action (chat header, its "…" menu by keyboard, a conversation row, a reply, the artifact panel, the
// floating chat's bar) renders, is clickable and reaches the host, "Float chat" is one of the panel's actions, and it all holds at phone width.
// Screenshots go to .cache/evidence/workspace-app/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q, qa } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const { misses } = await import('../studio/scripted-model.mjs');
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
  const live = () => browser.until('the chat is live', `${q('[data-testid=connection]')}?.dataset.state === 'connected' && !!${INPUT}`, 20000);

  await step('the page is the block: sessions pane, chat, no studio code', async () => {
    await live();
    assert.equal(await browser.evaluate(`${q('[data-boring=agent-workspace]')}.dataset.sessions`), 'docked');
    await browser.until('one chat listed', `${ROWS}.length === 1 && ${ROWS}[0].dataset.active === 'true'`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=sessions-toggle]')}.getAttribute('aria-expanded')`), 'true');
  });

  await step('defaults: without labels, icons or actions the blocks show their own words and no host actions', async () => {
    assert.deepEqual(await browser.evaluate(TEXTS), { title: 'Writer', placeholder: 'Message the agent…', send: 'Send', sessions: 'Chats', newChat: 'New', toggle: 'Hide chats', customIcon: false, hostActions: 0 });
  });

  const first = await browser.evaluate(ACTIVE);
  await step('a reply in the first chat', async () => {
    await say('Reply with exactly: AMBER-HARBOUR');
    await browser.until('the reply', `/AMBER-HARBOUR/.test(${REPLIES}) && ${idle}`, 20000);
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

  await step('the sessions pane lists both chats by their first message, and search filters them', async () => {
    await browser.until('both chats titled', `!!${row('AMBER-HARBOUR')} && !!${row('picnic plan')}`, 15000);
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
    await browser.evaluate(`${q('[data-testid=sessions-toggle]')}.dataset.mark = 'kept'`);
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
    assert.equal(await browser.evaluate(`${q('[data-testid=sessions-toggle]')}.dataset.mark`), 'kept', 'the toggle survived the switch and the connect');
  });

  await step('phone: sessions are a drawer, the artifact a full-screen sheet, no horizontal scroll', async () => {
    await browser.emulate('phone');
    await browser.until('narrow layout', `${q('[data-boring=agent-workspace]')}.dataset.sessions === 'closed' && innerWidth === 390`, 10000);
    const sheet = async name => {
      await browser.until('the sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && !!${q('[data-testid=artifact-panel]')}`, 10000);
      await pause(400);
      assert.deepEqual(await browser.evaluate(`(() => { const r = ${q('[data-testid=workspace-panel]')}.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`), { w: 390, h: 844 }, 'full screen');
      assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll with the sheet');
      await browser.screenshot(name);
      await browser.tap(q('[data-testid=artifact-close]'));
      await browser.until('the sheet closed', `!${q('[data-testid=artifact-panel]')}`, 5000);
    };
    // The panel open on the desktop is a full-screen sheet now.
    await sheet('workspace-app-phone-artifact.png');
    await pause(300);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll on the chat');
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

  // ---- The same app, configured through the blocks' props only.
  await step('configured: custom labels and one custom icon replace the defaults', async () => {
    await browser.evaluate(`location.search = '?configured'`);
    await browser.until('the configured page, live', `${q('[data-testid=app]')}?.dataset.configured === 'true' && ${q('[data-testid=connection]')}?.dataset.state === 'connected' && !!${INPUT}`, 20000);
    await browser.until('the reply of the open chat', `${idle} && !!${q('[data-testid=reply-action-quote]')}`, 20000);
    const texts = await browser.evaluate(TEXTS);
    assert.deepEqual({ ...texts, hostActions: undefined }, { title: 'Fernhill writer', placeholder: 'Ask Fernhill anything…', send: 'Ask', sessions: 'Projects', newChat: 'Start', toggle: 'Hide chats', customIcon: true, hostActions: undefined });
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
    await browser.click(q(`${ACTIONS} [data-testid=conversation-action-star]`));
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
