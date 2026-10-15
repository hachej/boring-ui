// The helpers every journey and scenario uses, over a driven browser (`launch` from @hachej/boring-testing/browser). Shared by the studio journey and the Cloudflare
// recipe's journey: both pages use the same registry components, so the same selectors work. Nothing here depends on a variant.
import assert from 'node:assert/strict';
import { pause, q, qa } from '@hachej/boring-testing/browser';
import { conversations } from './journey-ui.mjs';

/**
 * @param {object} options
 * @param {object} options.browser the driver from `launch` (@hachej/boring-testing/browser)
 * @param {string} options.pageUrl the URL the page was opened on
 * @param {Function} options.step `(name, run)` records and prints one step
 * @param {() => object} [options.app] the running studio (absent for a remote deployment)
 * @param {() => Promise<void>} options.restartHost restarts the host (the studio on the same data directory, or the Durable Object) and waits until it answers
 * @param {string} options.base the origin the host's API is reached on
 * @param {(request: Request) => Promise<Response>} options.authorize sends a request with the credentials the page would use
 */
export function createToolkit({ browser, pageUrl, step, app, restartHost, base, authorize }) {
  const MESSAGE = q('[data-testid=composer-input]');
  const LOG = q('[data-testid=transcript]');
  const logText = `(${LOG}?.innerText ?? '')`;
  // One primary button: Send while the agent is idle, Stop while it works.
  const SUBMIT = q('[data-testid=composer-submit]');
  const idle = `${SUBMIT}?.dataset.state === 'send'`;
  // A button is found by its visible text or, for icon buttons such as the composer's Send/Stop, by its aria-label.
  const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  const connected = `${q('[data-testid=connection]')}?.dataset.state === 'connected'`;
  const WORKSPACE = q('[data-testid=workspace-panel]');
  const SOURCE = q('[data-testid=workspace-panel] textarea');
  const history = conversations({ browser, logText });
  const dark = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  // A tap on a phone or tablet (touch emulation), a click otherwise.
  let touch = false;
  const press = selector => touch ? browser.tap(selector) : browser.click(selector);
  const device = async name => { touch = name !== 'desktop'; await browser.emulate(name); };

  // Idle: type and press the Send button. Busy: the same text is queued (Enter on a desktop, the Queue button on a touch device).
  const say = async text => {
    await browser.type(MESSAGE, text);
    if (await browser.evaluate(idle)) await press(button('Send'));
    else if (touch) await browser.tap(q('[data-testid=composer-queue]'));
    else await browser.press('Enter');
  };
  const clear = async () => { await browser.evaluate(`${MESSAGE}.focus(); ${MESSAGE}.select()`); await browser.press('Backspace'); await browser.until('composer cleared', `${MESSAGE}.value === ''`); };
  const ready = async () => { await browser.until('the chat is live', `${connected} && !!${MESSAGE}`, 60000); };
  // Page.reload returns before the old page is gone: wait for it, then for the new one to be live.
  const reload = async () => { await browser.reload(); await pause(600); await ready(); };
  /** A new, empty conversation of the shown variant (from the History list). */
  const fresh = async () => {
    await ready();
    // A panel left open by the previous scenario would cover the chat (a full-screen sheet on a phone).
    if (await browser.evaluate(`!!${WORKSPACE}`)) await closePanel();
    await history.create();
  };

  // The workspace panel (ArtifactWorkspace) is where every artifact, workspace file and the Workspace tabs open.
  const openPanel = async () => {
    if (!await browser.evaluate(`!!${WORKSPACE}`)) await press(q('[data-testid=studio-panel-open]'));
    await browser.until('the panel opens in the workspace', `!!${WORKSPACE}`, 15000);
  };
  const tab = async id => {
    // An artifact may have taken the panel over: go back to the Workspace tabs through the header button.
    if (!await browser.evaluate(`!!${q(`[data-testid=workspace-tab-${id}]`)}`) && await browser.evaluate(`!!${WORKSPACE}`)) await closePanel();
    await openPanel();
    // With a single view there is no tab bar: the panel already shows it. Git and Tasks tabs appear once they have something to show.
    if (id !== 'files') await browser.until(`the ${id} tab button`, `!!${q(`[data-testid=workspace-tab-${id}]`)}`, 15000);
    if (await browser.evaluate(`!!${q(`[data-testid=workspace-tab-${id}]`)}`)) await press(q(`[data-testid=workspace-tab-${id}]`));
    await browser.until(`the ${id} tab`, `${q('[data-testid=workspace-tabpanel], [role=tabpanel]')}?.dataset.tab === ${JSON.stringify(id)}`, 10000); };
  // An action under a viewer bar's "…" menu: open the menu (unless open), then choose the item. `scope` is a selector prefix, `prefix` the bar's test id prefix.
  const menu = async (scope, prefix, id) => {
    if (!await browser.evaluate(`!!${q(`${scope} [data-testid=${prefix}-more-list]`)}`)) await press(q(`${scope} [data-testid=${prefix}-more]`));
    await browser.until('the overflow menu', `!!${q(`${scope} [data-testid=${prefix}-more-list]`)}`, 5000);
    await press(q(`${scope} [data-testid=${prefix}-${id}]`));
  };
  // The panel's top bar offers full screen (Escape leaves it) and Close, on a desktop viewport; a phone shows the sheet with Close.
  const panelControls = async name => {
    const inside = label => `[...document.querySelectorAll('[data-testid=workspace-panel] button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
    assert.equal(await browser.evaluate(`!!${inside('Close')}`), true, `${name}: Close in the panel bar`);
    assert.equal(await browser.evaluate(`!!${inside('Enter full screen')}`), true, `${name}: full screen in the panel bar`);
    await browser.click(inside('Enter full screen'));
    await browser.until(`${name}: full screen`, `${WORKSPACE}?.dataset.fullscreen === 'true' && !!${inside('Exit full screen')}`, 5000);
    await browser.press('Escape');
    await browser.until(`${name}: Escape leaves full screen`, `${WORKSPACE}?.dataset.fullscreen === 'false'`, 5000);
  };
  // A viewer may re-render while it loads, so a click that landed on a replaced button is repeated.
  const closePanel = async () => {
    for (let attempt = 0; attempt < 4 && await browser.evaluate(`!!${WORKSPACE}`); attempt++) {
      await browser.click(`[...document.querySelectorAll('[data-testid=workspace-panel] button')].find(b => b.getAttribute('aria-label') === 'Close' || ['artifact-close', 'viewer-close'].includes(b.dataset.testid))`);
      await pause(700);
    }
    await browser.until('the panel closes', `!${WORKSPACE}`, 5000);
  };
  // Screenshots of the open panel: desktop and the 390px phone sheet, each in light and dark (evidence: <name>-desktop-light.png ...).
  const shotMatrix = async name => {
    const both = async kind => {
      await pause(700); await browser.screenshot(`${name}-${kind}-light.png`);
      await dark('dark'); try { await pause(400); await browser.screenshot(`${name}-${kind}-dark.png`); } finally { await dark('light'); }
    };
    await both('desktop');
    await browser.emulate('phone');
    try { await browser.reload(); await pause(800); await browser.until('phone sheet', `${WORKSPACE}?.dataset.sheet === 'true'`, 10000); await both('phone'); }
    finally { await browser.emulate('desktop'); await browser.until('desktop panel', `${WORKSPACE}?.dataset.sheet === 'false'`, 10000); }
  };
  /** Screenshot in the light scheme and then the dark one. */
  const shots = async name => { await browser.screenshot(`${name}.png`); await dark('dark'); try { await pause(300); await browser.screenshot(`${name}-dark.png`); } finally { await dark('light'); } };

  // What the agent did, read from the page so it works against a remote deployment too: tool names and assistant text.
  // (A question and an artifact are shown as cards, not as tool rows.)
  const domToolNames = () => browser.evaluate(`[...${qa('[data-testid=tool-name]')}.map(e => e.textContent), ...${qa('[data-testid=question-card]')}.map(() => 'ask_user'), ...${qa('[data-testid=artifact-card][data-state=ready]')}.map(() => 'present')]`);
  const assistantText = () => browser.evaluate(`${qa('[data-testid=transcript] article[data-role=assistant]')}.map(a => a.innerText).join('\\n')`);
  const userMessages = `${qa('[data-testid=transcript] article[data-role=user]')}.map(a => a.innerText.trim())`;
  // The native messages of the open conversation, when the studio runs in this process (not for a remote deployment).
  const messages = async () => {
    const id = await history.current();
    const conversation = app().conversations.get(String(id));
    const watch = await conversation.watch(app().host.context);
    const view = watch.value; await watch.stop();
    return view.entries.flatMap(entry => entry.model ?? []);
  };

  // Tool names in call order: from the native messages when the studio runs here (a question card has no tool row), else from the page.
  const toolNames = async () => app?.()
    ? (await messages()).flatMap(message => message.role === 'assistant' ? message.content.filter(part => part.type === 'toolCall').map(part => part.name) : [])
    : domToolNames();

  /** An authorized request to the host's API. */
  const api = (path, init) => authorize(new Request(new URL(path, base), init));

  return { api, restartHost, step, browser, pageUrl, history, q, qa, pause, say, clear, fresh, ready, reload, button, idle, connected, logText, LOG, MESSAGE, SUBMIT, WORKSPACE, SOURCE, dark, press, device,
    openPanel, tab, menu, panelControls, closePanel, shotMatrix, shots, toolNames, assistantText, userMessages, messages,
    get touch() { return touch; }, get app() { return app?.(); } };
}
