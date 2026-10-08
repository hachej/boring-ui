// Real-browser, real-model journey for the ambient agent bar. Needs CHROMIUM and a provider key (OPENAI_API_KEY by default).
// The page runs on an insecure origin (plain HTTP, not localhost) like the studio journeys. It proves: the host page stays usable under the bar,
// "Working for Ns" ticks, composer parity with PiChat and an upload, a second prompt queues in a tab behind the composer and can be steered, minimise to a pill, completion and "needs input" toasts, the compact bar
// growing into the chat window in place, artifacts opening inside the window (full screen, Escape, close, phone sheet), background-task toasts, drag with a remembered position,
// pill drag, arrow keys, Home and viewport clamping on a shrunken window, keyboard and Escape, the phone layout, and both
// variants in light and dark. Screenshots of every state go to .cache/evidence/ambient/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAmbient } from './server.mjs';
import { insecureUrl, launch, pause } from '@hachej/boring-testing/browser';

// `--scripted` (or STUDIO_MODEL=scripted): the deterministic layer, a scripted model (./script.mjs) instead of a real one; no key, no retries.
if (process.argv.includes('--scripted')) process.env.STUDIO_MODEL = 'scripted';

const evidence = process.env.AMBIENT_EVIDENCE ?? '.cache/evidence/ambient';
mkdirSync(evidence, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), 'boring-ambient-'));
const steps = [];
const step = async (name, run) => { const started = Date.now(); await run(); steps.push({ name, ms: Date.now() - started }); console.log(`ok  ${name} (${Date.now() - started} ms)`); };

const ROOT = `document.querySelector('[data-boring=ambient-chat]')`;
const STATE = `${ROOT}?.dataset.state`;
const INPUT = `document.querySelector('[data-testid=composer-input]')`;
const TITLE = `document.querySelector('[data-testid=ambient-title]')`;
const STATUS = `document.querySelector('[data-testid=ambient-status]')?.dataset.status`;
const TRANSCRIPT = `(document.querySelector('[data-testid=transcript]')?.innerText ?? '')`;
const toast = kind => `[...document.querySelectorAll('[data-testid=agent-toast]')].find(t => ${kind === undefined ? 'true' : `t.dataset.kind === ${JSON.stringify(kind)}`})`;
const control = testid => `document.querySelector('[data-boring=ambient-chat] [data-testid=${testid}]')`;
const rectOf = selector => `(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: document.documentElement.clientWidth - r.right, bottom: document.documentElement.clientHeight - r.bottom }; })()`;

const app = await startAmbient({ directory, port: 0 });
let browser;
try {
  const base = insecureUrl(app.url);
  browser = await launch(base, { evidence });
  const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  const goto = async (query = '') => {
    await browser.send('Page.navigate', { url: `${base}${query}` });
    await browser.until('the bar is live', `!!(${STATE} && ${INPUT} && !${INPUT}.disabled)`, 30000);
    await pause(400);
  };
  const say = async text => { await browser.type(INPUT, text); await browser.press('Enter'); };
  const shot = async name => { await pause(350); await browser.screenshot(`ambient-${name}.png`); };
  const mouse = (type, x, y) => browser.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const away = () => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  const idle = `${STATUS} !== 'working'`;

  await goto('?dismiss=4000');
  await step('environment: an insecure context, so the bar needs no secure-context API', async () => {
    const env = await browser.evaluate(`({ secure: window.isSecureContext, mic: !!document.querySelector('[data-testid=host-tool-mic]'), hand: !!document.querySelector('[data-testid=host-tool-hand]'), notification: typeof Notification })`);
    assert.equal(env.secure, false, 'journeys run on an insecure origin');
    assert.equal(env.mic, false, 'the host hides its microphone button where getUserMedia does not exist');
    assert.equal(env.hand, false, 'no placeholder host buttons: only controls that do something');
    assert.equal(await browser.evaluate(STATE), 'bar');
    assert.equal(await browser.evaluate(`${INPUT}.placeholder`), 'Do anything');
    await shot('01-bar-idle');
  });

  const FULL_CONTROLS = ['composer-file', 'composer-plus', 'composer-model', 'composer-submit', 'composer-input'];
  await step('composer parity: the bar has the same controls as a full PiChat (the + menu, / and @ menus, one model-and-effort pill, Send)', async () => {
    for (const testid of FULL_CONTROLS) assert.equal(await browser.evaluate(`!!${control(testid)}`), true, `the ambient composer has ${testid}`);
    assert.match(await browser.evaluate(`${control('composer-model-label')}.textContent`), / · /, 'the pill shows the model and the effort');
    assert.equal(await browser.evaluate(`!${control('effort-picker')} && !${control('model-picker')}`), true, 'no separate model or effort triggers');
    await browser.type(INPUT, '/');
    await browser.until('the slash menu', `!!${control('slash-menu')}`, 5000);
    await browser.evaluate(`(() => { const e = ${INPUT}; e.focus(); })()`);
    await browser.press('Escape');
    await browser.evaluate(`(() => { const e = ${INPUT}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await browser.type(INPUT, '@set');
    await browser.until('the mention menu', `!!${control('mention-menu')} && document.querySelectorAll('[data-testid=mention-item]').length > 0`, 5000);
    await browser.click(`document.querySelector('[data-testid=mention-item]')`);
    await browser.until('a mention chip', `!!document.querySelector('[data-testid=mention-chip]')`, 5000);
    await shot('01b-composer-menus');
    await browser.click(`document.querySelector('[data-testid=mention-chip] button')`);
    await browser.click(control('composer-model'));
    await browser.until('model and effort menu', `document.querySelectorAll('[data-testid=composer-effort-option]').length === 4 && document.querySelectorAll('[data-testid=composer-model-option]').length === 2`, 3000);
    const menu = await browser.evaluate(rectOf(control('composer-model-menu')));
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.right >= 0, `the effort menu is inside the viewport ${JSON.stringify(menu)}`);
    await shot('01c-effort-menu');
    await browser.press('Escape');
    await browser.click(control('composer-plus'));
    await browser.until('the + menu', `!!${control('composer-plus-menu')} && !!${control('composer-attach')}`, 3000);
    await shot('01c2-plus-menu');
    await browser.press('Escape');
    await browser.evaluate(`(() => { const e = ${INPUT}; const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(e, ''); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    // The same component in a full PiChat page.
    await browser.send('Page.navigate', { url: `${base}?view=full` });
    await browser.until('PiChat is live', `!!document.querySelector('[data-testid=composer]') && !document.querySelector('[data-boring=ambient-chat]')`, 30000);
    for (const testid of FULL_CONTROLS) assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=${testid}]')`), true, `PiChat has ${testid}`);
    assert.equal(await browser.evaluate(`document.querySelector('[data-testid=composer]').dataset.layout`), undefined, 'PiChat keeps its two-row layout');
    await pause(400);
    await browser.screenshot('ambient-01d-pichat-composer.png');
    await goto('?dismiss=4000');
  });

  await step('upload: the paperclip attaches an image and shows its chip; the chip can be removed', async () => {
    const png = join(directory, 'diagram.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHbyOkwAAAABJRU5ErkJggg==', 'base64'));
    await browser.attachFiles(control('composer-file'), [png]);
    await browser.until('an attachment chip', `document.querySelectorAll('[data-boring=ambient-chat] [data-testid=attachment]').length === 1`, 10000);
    assert.match(await browser.evaluate(`document.querySelector('[data-testid=attachment]').innerText`), /diagram\.png/);
    await shot('01e-attachment-chip');
    await browser.click(`document.querySelector('[data-testid=attachment] button')`);
    await browser.until('chip removed', `!document.querySelector('[data-testid=attachment]')`, 3000);
  });

  await step('a run shows a spinner and "Working for Ns" that ticks, while the host page stays usable under the bar', async () => {
    await say('Run the health check for 14 seconds, then report the result as two bullet points with a bold lead-in.');
    await browser.until('working status and spinner', `${STATUS} === 'working' && !!${control('ambient-status')}.querySelector('.animate-spin')`, 30000);
    await browser.until('placeholder counts', `/^Working for \\d+s$/.test(${INPUT}.placeholder)`, 10000);
    const first = Number((await browser.evaluate(`${INPUT}.placeholder`)).match(/\d+/)[0]);
    await browser.until('the count ticks', `Number(${INPUT}.placeholder.match(/\\d+/)?.[0] ?? -1) >= ${first + 2}`, 10000);
    // The host form under the bar takes input and saves while the agent works.
    await browser.type(`document.querySelector('#workspace-name')`, ' Renamed');
    assert.equal(await browser.evaluate(`document.querySelector('#workspace-name').value`), 'Acme Harbor Renamed');
    await browser.click(`document.querySelector('[data-testid=host-save]')`);
    await browser.until('the host form saved', `document.querySelector('[data-testid=host-saved]').textContent === 'Saved'`, 5000);
    assert.equal(await browser.evaluate(STATUS), 'working', 'the agent kept working');
    await shot('02-working');
  });

  await step('a second prompt queues inline and Steer sends it into the running turn', async () => {
    await say('When you are done, end your reply with the exact word BLUEBIRD.');
    await browser.until('one queued row', `document.querySelectorAll('[data-testid=queue-item]').length === 1`, 10000);
    assert.match(await browser.evaluate(`document.querySelector('[data-testid=queue-text]').textContent`), /BLUEBIRD/);
    assert.equal(await browser.evaluate(`!!${control('queue-steer')} && !!${control('queue-cancel')} && !!${control('queue-more')} && !${control('queue-edit')}`), true, 'Steer, remove and the "…" menu are on the row; edit is in the menu');
    const tab = await browser.evaluate(`(() => { const q = ${control('queue')}.getBoundingClientRect(), c = ${control('composer')}.getBoundingClientRect(); return { qTop: q.top, qBottom: q.bottom, cTop: c.top, qLeft: q.left, cLeft: c.left, qRight: q.right, cRight: c.right }; })()`);
    assert.ok(tab.qBottom > tab.cTop && tab.qBottom - tab.cTop < 20 && tab.qLeft > tab.cLeft && tab.qRight < tab.cRight, `the queue is a tab tucked behind the composer's top edge ${JSON.stringify(tab)}`);
    await browser.click(control('queue-more'));
    await browser.until('the menu offers Edit', `!!${control('queue-edit')}`, 3000);
    await shot('03-queued');
    await browser.press('Escape');
    await browser.until('the menu closed and the window stayed', `!${control('queue-edit')} && !!${ROOT}`, 3000);
    await browser.click(control('queue-steer'));
    await browser.until('the row now reads Steering (it is placed into the running turn)', `document.querySelector('[data-testid=queue-item]')?.dataset.mode === 'steer' && !${control('queue-steer')}`, 15000);
    await shot('03b-steering');
  });

  await step('minimise collapses to a pill that keeps the spinner; the finished run raises a toast with title and summary', async () => {
    await browser.click(control('ambient-minimize'));
    await browser.until('a pill', `${STATE} === 'minimized' && !!document.querySelector('[data-testid=ambient-pill]')`, 5000);
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=ambient-pill] .animate-spin')`), true, 'the pill shows the spinner while working');
    await shot('04-pill-working');
    await browser.until('a completion toast', `!!${toast('done')}`, 90000);
    const done = await browser.evaluate(`({ title: ${toast('done')}.querySelector('button').innerText, summary: ${toast('done')}.querySelector('[data-testid=agent-toast-summary]')?.textContent ?? '' })`);
    assert.ok(done.title.trim().length > 0 && done.summary.trim().length > 0, JSON.stringify(done));
    assert.ok(done.summary.length <= 141, 'the summary is one short line');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=ambient-unread]')`), true, 'the pill carries an unread dot');
    await shot('05-toast-over-pill');
  });

  await step('clicking the toast grows the same window in place into the chat, history intact; minimise returns to the bar', async () => {
    const before = await browser.evaluate(rectOf(ROOT));
    await browser.click(`${toast('done')}.querySelector('[data-testid=agent-toast-open]')`);
    await browser.until('expanded', `${STATE} === 'expanded' && !!document.querySelector('[data-testid=transcript]')`, 5000);
    await browser.until('the reply is in the transcript', `document.querySelectorAll('[data-testid=reply-actions]').length > 0`, 15000);
    assert.equal(await browser.evaluate(`!${toast()}`), true, 'the toast is gone once its conversation is open');
    const text = await browser.evaluate(TRANSCRIPT);
    assert.match(text, /health check/i, 'the first prompt is in the history');
    assert.match(text, /BLUEBIRD/i, 'the steered prompt reached the model');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=transcript] strong')`), true, 'a Markdown reply with bold');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=user-text]')`), true, 'a user bubble');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=reply-time]')?.textContent.match(/\\d/)`), true, 'a timestamp under the reply');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=reply-actions] [data-testid=copy]') && !!document.querySelector('[data-testid=feedback-up]') && !!document.querySelector('[data-testid=open-full]')`), true, 'copy, feedback and open in full');
    const after = await browser.evaluate(rectOf(ROOT));
    assert.ok(after.h > before.h + 100 && Math.abs(after.right - before.right) < 2 && Math.abs(after.bottom - before.bottom) < 2, `the window grew upward in place ${JSON.stringify({ before, after })}`);
    assert.ok(after.h <= (await browser.evaluate('innerHeight')) * 0.7 + 1, 'the window stays under 70% of the viewport');
    await shot('06-expanded');
    await browser.click(control('open-full'));
    await browser.until('the host was handed the conversation', `/Opening conversation/.test(document.querySelector('[data-testid=host-note]').textContent)`, 3000);
    await browser.click(control('ambient-minimize'));
    await browser.until('back to the compact bar', `${STATE} === 'bar'`, 3000);
    assert.ok((await browser.evaluate(rectOf(ROOT))).h < 200);
  });

  await step('an artifact card opens inside the chat window: it widens, the viewer sits beside the chat, full screen, Escape steps back, close shrinks it', async () => {
    await say('Write a short password rotation policy (two short paragraphs) as an artifact.');
    await browser.until('the run finished toast', `!!${toast('done')}`, 90000);
    await browser.click(`${toast('done')}.querySelector('[data-testid=agent-toast-open]')`);
    await browser.until('an artifact card', `!!document.querySelector('[data-testid=artifact-card][data-state=ready]')`, 15000);
    await shot('07-artifact-card');
    const before = await browser.evaluate(rectOf(ROOT));
    await browser.click(`document.querySelector('[data-testid=artifact-card][data-state=ready]')`);
    await browser.until('the viewer shows the document inside the window', `/password/i.test(document.querySelector('[data-boring=ambient-chat] [data-testid=artifact-panel]')?.innerText ?? '')`, 20000);
    await pause(500);
    const open = await browser.evaluate(`({ root: ${rectOf(ROOT)}, chat: ${rectOf(`${control('workspace-chat')}`)}, panel: ${rectOf(control('workspace-panel'))}, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
      host: document.querySelector('[data-testid=host-note]').textContent, hostViewer: !!document.querySelector('[data-testid=host-viewer]'), pressed: document.querySelector('[data-testid=artifact-card]').getAttribute('aria-pressed') })`);
    assert.ok(open.root.w > before.w + 300 && open.root.w > 800, `the window widened ${JSON.stringify({ before, open })}`);
    assert.ok(open.root.x >= 0 && open.root.y >= 0 && open.root.right >= 0 && open.root.bottom >= 0, 'the wide window is fully inside the viewport');
    assert.ok(open.chat.x < open.panel.x && open.chat.w >= 300 && open.panel.w >= 320, `chat on the left, artifact on the right ${JSON.stringify(open)}`);
    assert.equal(open.hostViewer, false, 'nothing opened in the host app');
    assert.ok(!/in the host viewer/.test(open.host), 'the host was not asked to open it');
    assert.equal(open.pressed, 'true', 'the card shows it is the one on display');
    assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=artifact-fullscreen]') && !!document.querySelector('[data-testid=artifact-close]') && !!document.querySelector('[data-testid=workspace-divider]')`), true, 'full screen, close and the divider');
    await shot('08-artifact-in-window');
    await browser.click(`document.querySelector('[data-testid=artifact-fullscreen]')`);
    await browser.until('full screen', `document.querySelector('[data-testid=workspace-panel]').dataset.fullscreen === 'true'`, 3000);
    await pause(400);
    const full = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=workspace-panel]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight }; })()`);
    assert.ok(full.x <= 1 && full.y <= 1 && full.w >= full.vw - 2 && full.h >= full.vh - 2, `the window covers the viewport ${JSON.stringify(full)}`);
    await shot('08b-artifact-fullscreen');
    await browser.press('Escape');
    await browser.until('Escape left full screen, the artifact stays open', `document.querySelector('[data-testid=workspace-panel]')?.dataset.fullscreen === 'false' && ${STATE} === 'expanded'`, 3000);
    await browser.press('Escape');
    await browser.until('the second Escape closed the artifact, not the window', `!document.querySelector('[data-testid=workspace-panel]') && ${STATE} === 'expanded'`, 3000);
    await pause(400);
    const closed = await browser.evaluate(rectOf(ROOT));
    assert.ok(closed.w < open.root.w - 300, `the window returned to its normal width ${JSON.stringify({ closed, open })}`);
    await browser.click(`document.querySelector('[data-testid=artifact-card][data-state=ready]')`);
    await browser.until('open again', `!!document.querySelector('[data-testid=workspace-panel]')`, 5000);
    await pause(600);
    await browser.click(`document.querySelector('[data-testid=artifact-close]')`);
    await browser.until('closed with the viewer button', `!document.querySelector('[data-testid=workspace-panel]')`, 3000);
    // Light and dark.
    await pause(600);
    await browser.click(`document.querySelector('[data-testid=artifact-card][data-state=ready]')`);
    await browser.until('open for the dark screenshot', `!!document.querySelector('[data-testid=artifact-panel]')`, 5000);
    await scheme('dark'); await shot('08c-artifact-in-window-dark'); await scheme('light');
    await pause(300);
    await browser.click(`document.querySelector('[data-testid=artifact-close]')`);
  });

  await step('phone: the artifact opens as a full-screen sheet over the window', async () => {
    await browser.emulate('phone');
    try {
      await goto('?dismiss=60000');
      await browser.click(control('ambient-title'));
      await browser.until('expanded', `${STATE} === 'expanded'`, 5000);
      await browser.until('the artifact card', `!!document.querySelector('[data-testid=artifact-card][data-state=ready]')`, 15000);
      await browser.tap(`document.querySelector('[data-testid=artifact-card][data-state=ready]')`);
      await browser.until('the sheet', `document.querySelector('[data-testid=workspace-panel]')?.dataset.sheet === 'true' && /password/i.test(document.querySelector('[data-testid=artifact-panel]')?.innerText ?? '')`, 20000);
      await pause(500);
      const sheet = await browser.evaluate(`(() => { const r = document.querySelector('[data-testid=workspace-panel]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: innerHeight }; })()`);
      assert.ok(sheet.x <= 1 && sheet.y <= 1 && sheet.w >= sheet.vw - 2 && sheet.h >= sheet.vh - 2, `a full-screen sheet ${JSON.stringify(sheet)}`);
      assert.equal(await browser.evaluate(`!document.querySelector('[data-testid=artifact-fullscreen]')`), true, 'no full screen button on a phone: it already is');
      await shot('08d-phone-artifact-sheet');
      await browser.tap(`document.querySelector('[data-testid=artifact-close]')`);
      await browser.until('back to the chat', `!document.querySelector('[data-testid=workspace-panel]') && ${STATE} === 'expanded'`, 3000);
      await browser.tap(control('ambient-minimize'));
    } finally { await browser.emulate('desktop'); }
  });

  await step('the host handoff stays available: artifactTarget=host calls artifacts.open and opens nothing inside', async () => {
    await goto('?artifacts=host&dismiss=60000');
    await browser.click(control('ambient-title'));
    await browser.until('the artifact card', `!!document.querySelector('[data-testid=artifact-card][data-state=ready]')`, 15000);
    await browser.click(`document.querySelector('[data-testid=artifact-card][data-state=ready]')`);
    await browser.until('the host was asked', `/Opening .* in the host viewer/.test(document.querySelector('[data-testid=host-note]').textContent)`, 3000);
    assert.equal(await browser.evaluate(`!document.querySelector('[data-testid=workspace-panel]')`), true, 'nothing opened inside the window');
    await goto('?dismiss=4000');
  });

  await step('a question raises a "needs input" toast that stays; the person answers it in the chat window', async () => {
    await say('I need to deploy. Use ask_user to let me choose between staging, production and canary, then confirm my choice in one sentence.');
    await browser.until('a needs-input toast', `!!${toast('input')}`, 60000);
    assert.equal(await browser.evaluate(STATUS), 'input', 'the header shows that the agent waits');
    await away();
    await shot('09-needs-input');
    await pause(6500);
    assert.equal(await browser.evaluate(`!!${toast('input')}`), true, 'a needs-input toast is never auto-dismissed (the others close after 4 s here)');
    await browser.click(`${toast('input')}.querySelector('[data-testid=agent-toast-open]')`);
    await browser.until('expanded with the question', `${STATE} === 'expanded' && !!document.querySelector('[data-testid=question-card][data-state=pending]')`, 10000);
    await shot('10-question-in-window');
    await browser.click(`[...document.querySelectorAll('[data-testid=question-option]')].find(b => /canary/i.test(b.dataset.option)) ?? document.querySelector('[data-testid=question-option]')`);
    await browser.until('the run continues and finishes', `${idle} && /canary|staging|production/i.test(${TRANSCRIPT}.split('Your answer')[1] ?? '')`, 60000);
    assert.equal(await browser.evaluate(`!${toast('input')}`), true, 'the needs-input toast is gone once answered');
    await shot('11-answered');
    await browser.click(control('ambient-minimize'));
    await browser.until('bar', `${STATE} === 'bar'`, 3000);
  });

  await step('a completion toast closes by itself; Escape closes the focused toast', async () => {
    await say('Reply with exactly three words.');
    await browser.until('a toast', `!!${toast('done')}`, 60000);
    await away();
    await browser.until('it closes by itself', `!${toast()}`, 12000);
    await say('Reply with exactly two words.');
    await browser.until('another toast', `!!${toast('done')}`, 60000);
    await browser.evaluate(`${toast('done')}.querySelector('[data-testid=agent-toast-open]').focus()`);
    await browser.press('Escape');
    await browser.until('Escape closed it', `!${toast()}`, 3000);
  });

  await step('keyboard: the title opens the window, Escape returns to the bar, every control has a name', async () => {
    await browser.evaluate(`${TITLE}.focus()`);
    await browser.press('Enter');
    await browser.until('expanded by keyboard', `${STATE} === 'expanded'`, 3000);
    assert.equal(await browser.evaluate(`document.activeElement === ${INPUT}`), true, 'focus moves to the message box');
    const unnamed = await browser.evaluate(`[...document.querySelectorAll('[data-boring=ambient-chat] button, [data-boring=ambient-chat] [role=switch]')].filter(b => !(b.getAttribute('aria-label') || b.title || b.textContent.trim())).length`);
    assert.equal(unnamed, 0, 'no unnamed controls');
    await browser.press('Escape');
    await browser.until('back to the bar', `${STATE} === 'bar'`, 3000);
    assert.equal(await browser.evaluate(`document.activeElement === ${TITLE}`), true, 'focus returns to the title');
    await browser.evaluate(`${control('ambient-grip')}.focus()`);
    const before = await browser.evaluate(rectOf(ROOT));
    await browser.press('ArrowLeft');
    await browser.until('the arrow key moved the bar', `${rectOf(ROOT)}.right === ${before.right + 16}`, 3000);
    await browser.press('ArrowRight');
  });

  await step('a background task raises its own toast; clicking it opens that conversation; the title menu switches back', async () => {
    const active = await browser.evaluate(`${TITLE}.textContent`);
    await browser.click(`document.querySelector('[data-testid=host-task]')`);
    await browser.until('a toast for the background conversation', `!!${toast('done')} && ${toast('done')}.querySelector('button').innerText.includes('Nightly export check')`, 120000);
    assert.equal(await browser.evaluate(`${TITLE}.textContent`), active, 'the bar still shows the conversation the person was in');
    await away();
    await shot('12-background-toast');
    await browser.click(`${toast('done')}.querySelector('[data-testid=agent-toast-open]')`);
    await browser.until('that conversation is open', `${STATE} === 'expanded' && /Nightly export check/.test(${TITLE}.textContent) && /Nightly export check/.test(${TRANSCRIPT})`, 15000);
    await browser.click(control('ambient-minimize'));
    await browser.until('bar', `${STATE} === 'bar'`, 3000);
    await browser.click(control('ambient-switch'));
    await browser.until('the conversation list', `!!document.querySelector('[data-testid=conversations]') && document.querySelectorAll('[data-testid=conversation-row]').length >= 2`, 5000);
    await shot('13-switcher');
    await browser.click(`[...document.querySelectorAll('[data-testid=conversation-row]')].find(row => row.dataset.active !== 'true')`);
    await browser.until('another conversation is open', `!/Nightly export check/.test(${TITLE}.textContent)`, 15000);
  });

  await step('dragging moves the bar, it stays inside the viewport, and a reload keeps the place', async () => {
    await pause(1000);
    const grip = await browser.evaluate(rectOf(control('ambient-grip')));
    const from = { x: grip.x + grip.w / 2, y: grip.y + grip.h / 2 };
    const drag = async (to) => {
      await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y);
      for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
      await mouse('mouseReleased', to.x, to.y);
    };
    const before = await browser.evaluate(rectOf(ROOT));
    await drag({ x: from.x - 380, y: from.y - 260 });
    const moved = await browser.evaluate(rectOf(ROOT));
    assert.ok(Math.abs((moved.x - before.x) + 380) < 3 && Math.abs((moved.y - before.y) + 260) < 3, `moved with the pointer ${JSON.stringify({ before, moved })}`);
    await shot('14-dragged');
    await browser.send('Page.reload'); await pause(500);
    await browser.until('reloaded', `!!(${STATE} && ${INPUT} && !${INPUT}.disabled)`, 30000);
    await pause(400);
    const kept = await browser.evaluate(rectOf(ROOT));
    assert.ok(Math.abs(kept.right - moved.right) < 2 && Math.abs(kept.bottom - moved.bottom) < 2, `the place survived a reload ${JSON.stringify({ moved, kept })}`);
    // Dragged to the top left corner of the page the bar is clamped inside the viewport, never lost; dragged to the bottom right it snaps back to the corner.
    const dragTo = async (target) => {
      const g = await browser.evaluate(rectOf(control('ambient-grip')));
      const start = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
      await mouse('mouseMoved', start.x, start.y); await mouse('mousePressed', start.x, start.y);
      for (let i = 1; i <= 8; i++) await mouse('mouseMoved', start.x + (target.x - start.x) * i / 8, start.y + (target.y - start.y) * i / 8);
      await mouse('mouseReleased', target.x, target.y);
    };
    await dragTo({ x: 2, y: 2 });
    const clamped = await browser.evaluate(rectOf(ROOT));
    console.log('clamped', JSON.stringify(clamped));
    assert.ok(clamped.x >= 0 && clamped.y >= 0, `clamped inside the viewport ${JSON.stringify(clamped)}`);
    const edge = await browser.evaluate(`({ x: document.documentElement.clientWidth + 300, y: document.documentElement.clientHeight + 300 })`);
    await dragTo(edge);
    const home = await browser.evaluate(rectOf(ROOT));
    assert.ok(home.right <= 30 && home.bottom <= 30, `snapped to the corner ${JSON.stringify(home)}`);
  });

  await step('the minimised pill can be dragged (a click still restores it), moved with the keyboard, reset with Home, and never leaves the viewport', async () => {
    await goto('?dismiss=60000');
    await browser.click(control('ambient-minimize'));
    await browser.until('a pill', `${STATE} === 'minimized'`, 3000);
    const PILL = `document.querySelector('[data-testid=ambient-pill-box]')`;
    const inside = rect => rect.x >= 0 && rect.y >= 0 && rect.right >= 0 && rect.bottom >= 0;
    const fully = async label => { const r = await browser.evaluate(rectOf(PILL)); assert.ok(inside(r), `${label}: the pill is inside the viewport ${JSON.stringify(r)}`); return r; };
    const dragFrom = async (selector, to) => {
      const r = await browser.evaluate(rectOf(selector));
      const from = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y);
      for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
      await mouse('mouseReleased', to.x, to.y);
      return from;
    };
    const start = await fully('start');
    // Dragging the label area of the pill (not only the grip) moves it and does not restore it.
    await dragFrom(`document.querySelector('[data-testid=ambient-pill]')`, { x: 500, y: 200 });
    const moved = await fully('after the drag');
    assert.equal(await browser.evaluate(STATE), 'minimized', 'a drag does not restore the pill');
    assert.ok(Math.abs(moved.x - start.x) > 200 && Math.abs(moved.y - start.y) > 200, `the pill moved ${JSON.stringify({ start, moved })}`);
    await shot('20-pill-dragged');
    // A drag past the edge is clamped.
    await dragFrom(control('ambient-grip'), { x: 1, y: 1 });
    const corner = await fully('dragged off the top left');
    assert.ok(corner.x <= 40 && corner.y <= 12, `held at the top left corner ${JSON.stringify(corner)}`);
    // Keyboard on the grip.
    await browser.evaluate(`${control('ambient-grip')}.focus()`);
    await browser.press('ArrowRight');
    await browser.until('ArrowRight moved the pill right', `${rectOf(PILL)}.x > ${corner.x + 8}`, 3000);
    assert.equal(await browser.evaluate(`getComputedStyle(${control('ambient-grip')}).outlineStyle !== 'none' || getComputedStyle(${control('ambient-grip')}).boxShadow !== 'none'`), true, 'the grip shows a focus ring');
    await browser.press('ArrowDown');
    await browser.until('ArrowDown moved it down', `${rectOf(PILL)}.y > ${corner.y + 8}`, 3000);
    await browser.press('Home');
    await browser.until('Home reset the default corner', `Math.abs(${rectOf(PILL)}.right - 16) < 2 && Math.abs(${rectOf(PILL)}.bottom - 16) < 2`, 3000);
    // A smaller window never hides it: park it far left, shrink the window, it is still fully visible.
    await dragFrom(control('ambient-grip'), { x: 40, y: 300 });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 420, deviceScaleFactor: 1, mobile: false });
    try {
      await pause(500);
      await fully('after shrinking the window');
      await shot('21-pill-small-window');
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 660, height: 300, deviceScaleFactor: 1, mobile: false });
      await pause(500);
      await fully('after shrinking it again');
    } finally { await browser.emulate('desktop'); }
    await pause(400);
    await fully('after restoring the window');
    // A plain click still restores it.
    await browser.click(`document.querySelector('[data-testid=ambient-pill]')`);
    await browser.until('a click restored the bar', `${STATE} === 'bar'`, 3000);
    // The expanded window, which grows, is clamped too: from the top left it opens fully on screen.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    try {
      await dragFrom(control('ambient-grip'), { x: 20, y: 20 });
      await browser.click(control('ambient-title'));
      await browser.until('expanded', `${STATE} === 'expanded'`, 3000);
      await pause(500);
      const grown = await browser.evaluate(rectOf(ROOT));
      assert.ok(inside(grown), `the grown window is inside the viewport ${JSON.stringify(grown)}`);
      await shot('22-expanded-small-window');
    } finally { await browser.emulate('desktop'); }
    await browser.click(control('ambient-minimize'));
    await browser.evaluate(`${control('ambient-grip')}.focus()`);
    await browser.press('Home');
  });

  await step('phone: a full-width bar docked at the bottom, no dragging, toasts above it, a full-height window', async () => {
    await browser.emulate('phone');
    try {
      await goto('?dismiss=60000');
      const bar = await browser.evaluate(rectOf(ROOT));
      assert.ok(bar.w >= 390 - 20 && bar.x >= 0 && bar.bottom < 24, `docked full width ${JSON.stringify(bar)}`);
      assert.equal(await browser.evaluate(`!${control('ambient-grip')}`), true, 'no drag handle on a phone');
      await browser.tap(control('ambient-minimize'));
      await browser.until('a pill', `${STATE} === 'minimized'`, 3000);
      const pill = await browser.evaluate(rectOf(`document.querySelector('[data-testid=ambient-pill-box]')`));
      assert.ok(pill.bottom < 24 && pill.x >= 0 && pill.right >= 0 && !(await browser.evaluate(`!!${control('ambient-grip')}`)), `the phone pill is docked at the bottom with no grip ${JSON.stringify(pill)}`);
      await shot('15a-phone-pill');
      await browser.tap(`document.querySelector('[data-testid=ambient-pill]')`);
      await browser.until('bar', `${STATE} === 'bar'`, 3000);
      await shot('15-phone-bar');
      // A phone keyboard has no Shift+Enter, so Enter is a newline there and the round button sends.
      await browser.type(INPUT, 'Reply with exactly four words.');
      await browser.tap(`document.querySelector('[data-testid=composer-submit]')`);
      await browser.until('a toast', `!!${toast('done')}`, 60000);
      const t = await browser.evaluate(rectOf(toast('done')));
      const b = await browser.evaluate(rectOf(ROOT));
      assert.ok(t.y + t.h <= b.y + 1, `the toast sits above the bar ${JSON.stringify({ t, b })}`);
      await shot('16-phone-toast');
      await browser.tap(`${toast('done')}.querySelector('[data-testid=agent-toast-open]')`);
      await browser.until('expanded', `${STATE} === 'expanded'`, 5000);
      const sheet = await browser.evaluate(rectOf(ROOT));
      const height = await browser.evaluate('innerHeight');
      assert.ok(sheet.h >= height - 2 && sheet.w >= 388, `a full-height sheet ${JSON.stringify(sheet)}`);
      await pause(500);
      await shot('17-phone-expanded');
      await browser.tap(control('ambient-minimize'));
      await browser.until('bar', `${STATE} === 'bar'`, 3000);
    } finally { await browser.emulate('desktop'); }
  });

  await step('both variants, light and dark host', async () => {
    for (const variant of ['contrast', 'surface']) for (const mode of ['light', 'dark']) {
      await scheme(mode);
      await goto(`?variant=${variant}&dismiss=4000`);
      await shot(`18-${variant}-${mode}-bar`);
      await browser.click(`${TITLE}`);
      await browser.until('expanded', `${STATE} === 'expanded' && !!document.querySelector('[data-testid=transcript]')`, 5000);
      await browser.until('history shows', `document.querySelectorAll('[data-testid=reply-actions]').length > 0 || document.querySelectorAll('[data-testid=user-text]').length > 0`, 10000);
      await shot(`19-${variant}-${mode}-expanded`);
    }
    await scheme('light');
  });

  if (process.env.STUDIO_MODEL === 'scripted') assert.deepEqual((await import('../studio/scripted-model.mjs')).misses, [], 'every message the scripted model saw had a script');
  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource|ERR_CONNECTION|net::|TypeError: Failed to fetch|network error/i.test(problem)), []);
  writeFileSync(join(evidence, 'journey.json'), JSON.stringify({ provider: app.provider, steps }, null, 2));
  console.log(JSON.stringify({ provider: app.provider, steps }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  if (browser) { await browser.screenshot('ambient-last.png').catch(() => {}); await browser.close(); }
  await Promise.race([app.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 15000))]);
  process.exit(process.exitCode ?? 0);
}
