// A phone (390x844, touch) and a tablet (768x1024): one column with the chat as the main view, panels as full-screen sheets, no horizontal
// overflow, menus inside the viewport, and touch targets of at least 40x40 CSS px. Real browser input through the DevTools protocol
// (touch events), real models. Screenshots (light and dark): mobile-*, tablet-*.
import assert from 'node:assert/strict';
import { VIEWER_FILES } from '../fixtures/workspace-files.mjs';
import { artifactKit } from './_artifacts.mjs';
import { phoneKit } from './_phone.mjs';
import { viewerKit } from './_viewers.mjs';
import { writeAndPresent } from './_script.mjs';

const CARD = '[data-testid=artifact-card][data-state=ready]';

export default [
  {
    id: 'phone-chat', group: 'Phone layout', title: 'Chat on a phone', viewport: 'phone', requires: ['workspace'],
    description: 'One column, the header and composer fit, Enter is a newline and the Send button sends, menus open inside the screen, the Workspace is a full-screen sheet.',
    steps: [{ prompt: 'Reply with exactly: HELLO-PHONE' }],
    expect: [{ reply: /HELLO-PHONE/ }],
    async verify(t) {
      const { browser, q, qa, MESSAGE, SUBMIT, idle, logText, pause, shots } = t;
      const p = phoneKit(t);
      assert.equal(await browser.evaluate(`innerWidth`), 390);
      assert.equal(await browser.evaluate(`matchMedia('(pointer: coarse)').matches`), true, 'touch emulation reports a coarse pointer');
      assert.equal(await browser.evaluate(`getComputedStyle(${q('.studio')}).gridTemplateColumns.split(' ').length`), 1, 'one column');
      await p.noOverflow('chat with messages');
      await shots('mobile-chat-messages');
      await p.check('header', 'document.querySelector(".studio-bar")');
      await p.check('chat', 'document.querySelector("[data-testid=workspace-chat]")');

      // A message is typed, Enter makes a newline, the Send button sends and the answer streams.
      const users = () => browser.evaluate(`${qa('[data-testid=transcript] [data-role=user]')}.length`);
      await browser.type(MESSAGE, 'Reply with exactly: HELLO-AGAIN');
      await pause(800);
      const sentBefore = await users();
      await browser.press('Enter');
      assert.match(await browser.evaluate(`${MESSAGE}.value`), /HELLO-AGAIN\n$/, 'Enter inserts a newline on a touch device');
      await pause(800);
      assert.equal(await users(), sentBefore, 'Enter did not send');
      assert.match(await browser.evaluate(`${MESSAGE}.value`), /HELLO-AGAIN\n$/, 'the draft is kept');
      assert.ok(await browser.evaluate(`parseFloat(getComputedStyle(${MESSAGE}).fontSize)`) >= 16, 'composer text is at least 16px');
      await browser.tap(SUBMIT);
      await browser.until('answer', `/HELLO-AGAIN/.test(${logText}.replace('Reply with exactly: HELLO-AGAIN', '')) && ${idle}`, 120000);

      // The / menu and the model picker open inside the viewport and an item is chosen by tap.
      await browser.type(MESSAGE, '/');
      await browser.until('slash menu', `!!${q('[data-testid=slash-menu]')}`);
      assert.equal(await p.inViewport('[data-testid=slash-menu]'), true, 'the / menu is inside the viewport');
      assert.ok(await p.inViewport('[data-testid=slash-search]'), 'its search box is reachable');
      await p.noOverflow('slash menu');
      await shots('mobile-slash');
      await p.check('slash menu', 'document.querySelector("[data-testid=slash-menu]")');
      await browser.tap(`${qa('[data-testid=slash-item]')}.find(i => i.dataset.name === 'clear')`);
      await browser.until('menu closed', `!${q('[data-testid=slash-menu]')}`);
      await browser.type(MESSAGE, '@'); await browser.until('mention menu', `!!${q('[data-testid=mention-menu]')}`);
      assert.equal(await p.inViewport('[data-testid=mention-menu]'), true, 'the @ menu is inside the viewport');
      await p.check('mention menu', 'document.querySelector("[data-testid=mention-menu]")');
      await browser.tap(`${q('[data-testid=mention-item]')}`);
      await browser.until('mention chosen', `/@/.test(${MESSAGE}.value) && !${q('[data-testid=mention-menu]')}`);
      await t.clear();
      const before = await browser.evaluate(`${q('[data-testid=composer-model]')}.dataset.value`);
      await browser.tap(q('[data-testid=composer-model]'));
      await browser.until('model menu', `!!${q('[data-testid=composer-model-menu]')}`);
      assert.equal(await p.inViewport('[data-testid=composer-model-menu]'), true, 'the model menu is inside the viewport');
      await p.noOverflow('model menu');
      await shots('mobile-model');
      await p.check('model menu', 'document.querySelector("[data-testid=composer-model-menu]")');
      await browser.tap(`${qa('[data-testid=composer-model-option]')}.find(o => o.dataset.value !== ${JSON.stringify(before)})`);
      await browser.until('model changed', `${q('[data-testid=composer-model]')}.dataset.value !== ${JSON.stringify(before)}`, 15000);
      await p.check('composer bar', 'document.querySelector("[data-testid=composer]")');

      // The Workspace is the full-screen sheet with a close control, and nothing overflows.
      assert.equal(await browser.evaluate(`!${q('[data-testid=workspace-panel]')}`), true, 'the panel is not squeezed under the chat');
      await browser.tap(q('[data-testid=studio-panel-open]'));
      await browser.until('sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true'`);
      await pause(300);
      const box = await browser.evaluate(`(() => { const r = ${q('[data-testid=workspace-panel]')}.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`);
      assert.deepEqual(box, { w: 390, h: 844 }, 'full screen');
      assert.equal(await browser.evaluate(`!${q('[data-testid=workspace-divider]')} && !${q('[data-testid=workspace-panel] [aria-label="Enter full screen"]')} && !!${q('[data-testid=workspace-panel] [aria-label=Close]')}`), true, 'a sheet has Close and no divider or full screen button');
      await p.noOverflow('side panel');
      await shots('mobile-sheet');
      await p.check('side panel', 'document.querySelector("[data-testid=workspace-panel]")');
      await browser.tap(q('[data-testid=workspace-panel] [aria-label=Close]'));
      await browser.until('back to chat', `!${q('[data-testid=workspace-panel]')}`);
      await p.reportSmall('mobile-chat');
    },
  },
  {
    id: 'phone-artifacts', group: 'Phone layout', title: 'Artifacts on a phone', viewport: 'phone', requires: ['workspace'],
    description: 'A card opens the full-screen artifact sheet with the less used actions in the overflow menu; closing returns to the same scroll position.',
    steps: [{ prompt: 'Write two files and present each before you reply: first a short fictional packing list for a day hike as a markdown document, then a small separate HTML page for the same hike. Reply in one sentence.' }],
    script: { 0: [
      ...writeAndPresent('hike/packing-list.md', '# Day hike packing list\n\nA fictional list for an invented hike.\n\n- Water, two litres\n- Rain jacket\n- Sandwiches and fruit\n- A paper map of Mount Placeholder\n'),
      ...writeAndPresent('hike/page.html', '<!doctype html><html><body><h1>Day hike</h1><p>Meet at Placeholder Pier at nine.</p></body></html>'),
      'Both are ready.',
    ] },
    expect: [{ artifact: { type: 'markdown', count: 1 } }, { artifact: { type: 'html', count: 1 } }],
    async verify(t) {
      const { browser, q, qa, pause, shots } = t;
      const p = phoneKit(t);
      await pause(500);
      assert.equal(await browser.evaluate(`!${q('[data-testid=artifact-panel]')}`), true, 'a phone keeps to the card: the sheet does not cover the chat by itself');
      await shots('mobile-artifact-card');
      await p.check('artifact cards', 'document.querySelector("[data-testid=transcript]")');
      await browser.evaluate(`${qa(CARD)}[0].scrollIntoView({ block: 'center' })`); await pause(500);
      const before = await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`);
      await browser.tap(`${qa(CARD)}[0]`);
      await browser.until('artifact panel', `!!${q('[data-testid=artifact-panel]')}`);
      await browser.until('content', `${q('[data-testid=artifact-body]')}?.innerText.length > 40`);
      await pause(300);
      assert.deepEqual(await browser.evaluate(`(() => { const r = ${q('[data-testid=viewer-panel]')}.getBoundingClientRect(); return { w: r.width, h: r.height }; })()`), { w: 390, h: 844 }, 'full screen');
      await p.noOverflow('artifact panel');
      // The panel is a sheet: a close control, no divider to drag and no full screen button (it already is full screen).
      assert.equal(await browser.evaluate(`${q('[data-testid=workspace-panel]')}.dataset.sheet`), 'true');
      assert.equal(await browser.evaluate(`!${q('[data-testid=workspace-divider]')} && !${q('[data-testid=artifact-fullscreen]')} && !!${q('[data-testid=artifact-close]')}`), true);
      await shots('mobile-artifact');
      await p.check('artifact panel', 'document.querySelector("[data-testid=viewer-panel]")');
      for (const id of ['artifact-share', 'artifact-more', 'artifact-close']) assert.ok(await p.inViewport(`[data-testid=${id}]`), `${id} is reachable`);
      // On a phone the less used actions (Reload, Copy, Download) sit in the overflow menu of the standard bar.
      await browser.tap(q('[data-testid=artifact-more]'));
      await browser.until('overflow menu', `!!${q('[data-testid=artifact-more-list]')}`);
      for (const id of ['artifact-refresh', 'artifact-download']) assert.ok(await p.inViewport(`[data-testid=${id}]`), `${id} is reachable in the overflow menu`);
      await browser.press('Escape');
      await browser.until('overflow menu closed', `!${q('[data-testid=artifact-more-list]')}`);
      assert.ok(await browser.evaluate(`!!${q('[aria-label=Copy], [data-testid=copy]')}`) && await p.inViewport('[data-testid=copy]'), 'copy is reachable');
      await browser.tap(q('[data-testid=artifact-close]'));
      await browser.until('closed', `!${q('[data-testid=artifact-panel]')}`);
      await pause(300);
      // (a few pixels of rounding while the transcript settles are not a lost position)
      assert.ok(Math.abs(await browser.evaluate(`${q('[data-testid=transcript-scroll]')}.scrollTop`) - before) <= 8, 'the chat scroll position is unchanged');
      // The second card is HTML: open it and check that it fits.
      await browser.tap(`${qa(CARD)}[1]`);
      await browser.until('html panel', `!!${q('[data-testid=artifact-panel][data-artifact-type=html] iframe')}`);
      await p.noOverflow('html artifact');
      await browser.tap(q('[data-testid=artifact-close]'));
      await p.reportSmall('mobile-artifacts');
    },
  },
  {
    id: 'phone-queue-history', group: 'Phone layout', title: 'Queue and History on a phone', viewport: 'phone',
    description: 'A message sent while busy waits in the queue with Steer now, edit and remove; the sessions pane is a drawer.',
    steps: [{ prompt: 'Without using tools or artifacts, write the numbers from 1 to 250 in English words, one per line, directly in the chat.', wait: false }],
    async verify(t) {
      const { browser, q, qa, MESSAGE, SUBMIT, pause, shots } = t;
      const p = phoneKit(t);
      await browser.until('working', `${SUBMIT}?.dataset.state === 'stop'`, 30000);
      assert.equal(await browser.evaluate(`!${q('[data-testid=when-busy]')}`), true, 'no toggle in the composer');
      await browser.type(MESSAGE, 'Second message: reply with exactly: PHONE-QUEUE-ONE, and nothing else.');
      // Enter is a newline on a touch device; the Queue button sends.
      await browser.tap(q('[data-testid=composer-queue]'));
      await browser.until('queued', `${qa('[data-testid=queue-item]')}.length === 1`, 15000);
      await pause(300);
      await p.noOverflow('queue');
      for (const id of ['queue-steer', 'queue-more', 'queue-cancel']) assert.ok(await p.inViewport(`[data-testid=${id}]`), `${id} is on screen`);
      await p.check('queue', 'document.querySelector("[data-testid=queue]")');
      await shots('mobile-queue');
      await browser.tap(q('[data-testid=queue-cancel]'));
      await browser.until('removed', `${qa('[data-testid=queue-item]')}.length === 0`, 15000);
      await browser.tap(SUBMIT);
      await browser.until('idle', `${SUBMIT}?.dataset.state === 'send'`, 30000);
      await browser.tap(q('[data-testid=sessions-toggle]'));
      await browser.until('sessions drawer', `${q('[data-testid=conversations]')}?.dataset.drawer === 'true'`, 5000);
      await pause(300);
      const drawer = await browser.evaluate(`(() => { const r = ${q('[data-testid=conversations]')}.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; })()`);
      assert.ok(drawer.x === 0 && drawer.w > 300 && drawer.w <= 390 && drawer.h === 844, `a full-height drawer inside the screen: ${JSON.stringify(drawer)}`);
      await p.noOverflow('history');
      await shots('mobile-history');
      await p.check('history', 'document.querySelector("[data-testid=conversations]")');
      await browser.tap(q('[data-testid=conversation-new]'));
      await browser.until('a new conversation, the drawer closed', `!${q('[data-testid=conversations]')} && ${q('[data-testid=transcript]')}?.innerText.trim() === ''`, 20000);
      await p.reportSmall('mobile-queue-history');
    },
  },
  {
    id: 'tablet-layout', group: 'Phone layout', title: 'Chat and panels on a tablet', viewport: 'tablet', requires: ['workspace'],
    description: '768x1024: no horizontal overflow on the chat, the Workspace sheet and an artifact panel.',
    steps: [{ prompt: 'Write a short fictional packing list for a day hike as a markdown document, write it to a file and present it. Reply in one sentence.' }],
    script: { 0: [...writeAndPresent('hike/packing-list.md', '# Day hike packing list\n\nA fictional list for an invented hike.\n\n- Water, two litres\n- Rain jacket\n- Sandwiches and fruit\n- A paper map of Mount Placeholder\n'), 'The list is ready.'] },
    expect: [{ artifact: { type: 'markdown', count: 1 } }],
    async verify(t) {
      const { browser, q, qa, pause, shots } = t;
      const p = phoneKit(t);
      assert.equal(await browser.evaluate(`innerWidth`), 768);
      await p.noOverflow('tablet chat'); await shots('tablet-chat');
      await browser.tap(q('[data-testid=studio-panel-open]'));
      await browser.until('sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true'`); await pause(300);
      await p.noOverflow('tablet side panel'); await shots('tablet-sheet');
      await browser.tap(q('[data-testid=workspace-panel] [aria-label=Close]'));
      await browser.until('closed', `!${q('[data-testid=workspace-panel]')}`);
      await browser.tap(`${qa(CARD)}[0]`);
      await browser.until('artifact panel', `!!${q('[data-testid=artifact-panel]')}`);
      await browser.until('content', `${q('[data-testid=artifact-body]')}?.innerText.length > 40`); await pause(300);
      await p.noOverflow('tablet artifact panel'); await shots('tablet-artifact');
      await browser.tap(q('[data-testid=artifact-close]'));
      void artifactKit;
    },
  },
  {
    id: 'phone-file-viewers', group: 'Phone layout', title: 'File viewers on a phone', viewport: 'phone', requires: ['workspace'], seed: VIEWER_FILES, panel: 'files', steps: [{ action: 'openPanel' }],
    description: 'The viewer bar fits 390 px with touch-sized targets, Share is reachable and the overflow menu holds the rest.',
    async verify(t) {
      const { browser, q, pause, shots } = t;
      const p = phoneKit(t);
      const k = viewerKit(t);
      const { VIEWER } = k;
      for (const [rel, kind] of [['docs/picnic-plan.md', 'markdown'], ['media/moon-badge.png', 'image'], ['docs/tide-times.html', 'html'], ['media/moon-brief.pdf', 'pdf']]) {
        await browser.send('Page.navigate', { url: k.link(rel) });
        await pause(600);
        await browser.until('phone layout', `innerWidth === 390`, 30000);
        // A shared link opens the file in the panel, which on a phone is a full-screen sheet over the chat.
        await browser.until(`${rel} viewer`, `${q(`${VIEWER(rel)}[data-kind=${kind}] [data-testid=viewer-bar]`)} !== null`, 30000);
        await pause(500);
        await p.noOverflow(`phone ${rel}`);
        const bar = `${VIEWER(rel)} [data-testid=viewer-bar]`;
        const geometry = await browser.evaluate(`(() => { const bar = ${q(bar)}.getBoundingClientRect(); const buttons = ${k.qa(`${bar} button`)}.filter(b => b.checkVisibility());
          const mids = buttons.map(b => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; });
          return { bar: bar.height, spread: Math.max(...mids) - Math.min(...mids), right: Math.max(...buttons.map(b => b.getBoundingClientRect().right)), small: buttons.filter(b => b.getBoundingClientRect().height < 40).map(b => b.getAttribute('aria-label') ?? b.textContent), inside: bar.right <= innerWidth + 0.5 }; })()`);
        assert.ok(geometry.inside && geometry.right <= 390.5, `${rel}: every bar control is inside the screen ${JSON.stringify(geometry)}`);
        assert.deepEqual(geometry.small, [], `${rel}: touch targets of at least 40px`);
        assert.equal(await browser.evaluate(`!!${q(`${VIEWER(rel)} [data-testid=viewer-more]`)}`), true, `${rel}: Reload, Copy, Download and the rest sit in the overflow menu`);
        assert.equal(await browser.evaluate(`!${q(`${VIEWER(rel)} [data-testid=viewer-close]`)} === false`), true, `${rel}: Close stays on the bar`);
        assert.ok(geometry.bar <= 66 && geometry.spread <= 6, `${rel}: the phone bar is one row ${JSON.stringify(geometry)}`);
        await shots(`fileviewers-phone-${kind}`);
      }
      await browser.tap(q(`${VIEWER('media/moon-brief.pdf')} [data-testid=viewer-more]`));
      await browser.until('overflow menu', `!!${q('[data-testid=viewer-more-list]')}`);
      assert.deepEqual(await browser.evaluate(`${k.qa('[data-testid=viewer-more-list] [role=menuitem]')}.map(b => b.textContent)`), ['Reload', 'Download', 'Open in new tab']);
      await shots('fileviewers-phone-menu');
      await browser.press('Escape');
    },
  },
];
