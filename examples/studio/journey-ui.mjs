// Small helpers shared by the UI journeys (chatui, menus, durability, artifacts, mobile): the sessions pane of conversations (the pi-app
// block's left pane, a drawer on a narrow screen) and the current conversation id. Kept out of journeys/ because every file there is a journey.
import { q, qa } from '@hachej/boring-testing/browser';

export function conversations(t) {
  const { browser, logText } = t;
  /** Shows the list: docked it is already there (shown again if the person hid it); on a narrow screen the toggle opens the drawer. */
  const open = async () => {
    if (await browser.evaluate(`!!${q('[data-testid=conversations]')}`)) return;
    await browser.click(q('[data-testid=sessions-toggle]'));
    await browser.until('the sessions list is shown', `!!${q('[data-testid=conversations]')}`, 5000);
  };
  /** Closes the drawer (Escape); a docked pane stays. */
  const close = async () => {
    if (await browser.evaluate(`${q('[data-testid=conversations]')}?.dataset.drawer !== 'true'`)) return;
    await browser.press('Escape');
    await browser.until('the sessions drawer is closed', `!${q('[data-testid=conversations]')}`, 5000);
  };
  const rows = () => browser.evaluate(`${qa('[data-testid=conversation-row]')}.map(row => ({ id: row.dataset.conversationId, title: row.querySelector('span').textContent, active: row.dataset.active === 'true', time: row.lastElementChild.textContent.trim() }))`);
  /** Replaces the search text (empty: the whole list again). */
  const search = async text => {
    await open();
    await browser.evaluate(`(() => { const e = ${q('[data-testid=conversation-search]')}; e.focus(); e.select(); })()`);
    await browser.press('Backspace');
    if (text) await browser.type(q('[data-testid=conversation-search]'), text);
  };
  return {
    open, close, rows, search,
    /** The id of the conversation that is open. */
    current: () => browser.evaluate(`${q('[data-testid=studio-main]')}.dataset.conversation`),
    /** How many conversations the open demo has, from the sessions list. */
    count: async () => { await open(); const list = await rows(); await close(); return list.length; },
    /** Start a new conversation from the sessions list and wait for the empty one. */
    create: async () => {
      const before = await browser.evaluate(`${q('[data-testid=studio-main]')}.dataset.conversation`);
      await open();
      await browser.click(q('[data-testid=conversation-new]'));
      await browser.until('a new, empty conversation', `${q('[data-testid=studio-main]')}.dataset.conversation !== ${JSON.stringify(before)} && ${logText}.trim() === '' && ${q('[data-testid=connection]')}?.dataset.state === 'connected'`, 20000);
    },
    /** Switch to an existing conversation by id through the sessions list. */
    select: async id => {
      await open();
      await browser.click(`${qa('[data-testid=conversation-row]')}.find(row => row.dataset.conversationId === ${JSON.stringify(String(id))})`);
      await browser.until('the conversation is open', `${q('[data-testid=studio-main]')}.dataset.conversation === ${JSON.stringify(String(id))} && ${q('[data-testid=connection]')}?.dataset.state === 'connected'`, 20000);
    },
  };
}
