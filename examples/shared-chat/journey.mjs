import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';
import { startSharedChat } from './server.mjs';
import { auditAgentContrast, auditSmallText } from './colour-audit.mjs';
import { checkStory } from './story-checks.mjs';

const evidence = process.env.SHARED_CHAT_EVIDENCE ?? '.cache/evidence/shared-chat/r9';
mkdirSync(evidence, { recursive: true });
const app = await startSharedChat();
let browser;
const input = q('[data-testid=composer-input]');
const message = id => q(`[data-shared-message="${id}"]`);
const trace = `${message('pdf-plan')}.querySelector('[data-testid=activity]')`;
const avatar = `${message('pdf-card')}.querySelector('[data-testid=message-avatar] [data-slot=avatar]')`;
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth';
try {
  for (const [device, width, height] of [['phone', 390, 844], ['desktop', 1440, 1000]]) {
    await browser?.close(); browser = undefined;
    browser = await launch(`${app.url}?manual`, { evidence, args: ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] });
    if (device === 'phone') await browser.emulate(device);
    assert.equal(await browser.evaluate("matchMedia('(hover: hover)').matches"), device === 'desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
    for (const scheme of process.argv.includes('--parity') ? ['light'] : ['light', 'dark']) {
      await browser.reload();
      await browser.until('shared room', `!!${input} && !!${q('[data-testid=shared-members]')} && !!${message('via-person')}`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${scheme === 'dark'})`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      const shot = async name => {
        if (name !== 'room-overview') return;
        await browser.evaluate('document.activeElement?.blur()');
        if (device === 'desktop') await browser.hover(q('[data-testid=workspace-bar-title]'));
        await pause(250); await browser.screenshot(`${width}-${scheme}-${name}.png`);
      };
      const reveal = async id => { await browser.evaluate(`${message(id)}.scrollIntoView({ block: 'nearest', behavior: 'instant' })`); await pause(150); };
      const inlineMention = async (selector, name = 'PM') => {
        assert.equal(await browser.evaluate(`${selector}.querySelector('[data-testid=mention-name]').textContent`), name);
        assert.equal(await browser.evaluate(`${selector}.textContent.includes('@')`), false);
        assert.equal(await browser.evaluate(`!!${selector}.querySelector('[data-slot=avatar]')`), true);
        assert.equal(await browser.evaluate(`(() => { const s = getComputedStyle(${selector}); return s.fontWeight === '500' && s.paddingTop === '0px' && s.paddingLeft === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)'; })()`), true);
      };
      const exposeActions = async id => {
        await reveal(id);
        if (device === 'phone') {
          const point = await browser.evaluate(`(() => { const r = ${message(id)}.querySelector('[data-testid=request-title]').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await pause(550);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await browser.hover(message(id));
        await browser.until('Reply is exposed', `(() => { const e = ${message(id)}.querySelector('[data-testid=shared-message-actions]'); return !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity === '1'; })()`);
      };
      assert.equal(await browser.evaluate(`!!${q('[data-testid=sessions-toggle]')}`), false);
      assert.equal(await browser.evaluate(`!!${q('[data-testid=shared-status]')}`), false);
      for (const status of ['reconnecting', 'offline']) {
        await browser.evaluate(`window.__SHARED__.setStatus('${status}')`);
        await browser.until('problem status', `${q('[data-testid=shared-status]')}?.dataset.status === '${status}'`);
      }
      await browser.evaluate("window.__SHARED__.setStatus('live')");
      await browser.until('quiet live bar', `!${q('[data-testid=shared-status]')}`);
      assert.equal(await browser.evaluate(`${message('via-person')}.querySelector('[data-testid=message-via]').textContent`), 'via Claude');
      assert.equal(await browser.evaluate(`${qa('[data-testid=day-separator]')}.length`), 1);
      assert.match(await browser.evaluate(`${q('[data-testid=day-separator]')}.textContent`), /^jeu\. 10 sept\.$/);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('Début de la conversation')`), false);

      await browser.type(input, '@');
      await browser.until('host membership picker', `${qa('[data-testid=mention-item]')}.length === 5`);
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=mention-item]')}.map(e => e.dataset.path)`), ['pm', 'data', 'mira', 'leo', 'julien']);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('Builder')`), false);
      await browser.press('Enter'); await browser.type(input, '@data ajoute un export PDF');
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('PM replies', `!!${message('pdf-plan')} && window.__SHARED__.sends.at(-1)?.mentions.includes('pm')`);
      await browser.evaluate('window.__SHARED__.planReady()');
      await browser.until('PM plan', `${message('pdf-plan')}.innerText.includes('une version que vous pourrez essayer')`);
      const ownId = await browser.evaluate(`'sent-' + window.__SHARED__.sends.at(-1).clientId`);
      await inlineMention(`${message(ownId)}.querySelector('[data-testid=message-mention][data-path=pm]')`);
      await inlineMention(`${message(ownId)}.querySelector('[data-testid=message-mention][data-path=data]')`, 'Data');
      const baselines = await browser.evaluate(`(() => {
        const row = ${message(ownId)}, mentions = [...row.querySelectorAll('[data-testid=message-mention]')];
        const text = [...row.querySelector('[data-testid=user-text] > span').childNodes].findLast(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        const rect = node => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect(); };
        const gap = e => Math.abs(rect(e.querySelector('[data-testid=mention-name]')).bottom - rect(text).bottom);
        const corrected = mentions.map(gap);
        mentions[0].classList.replace('items-baseline', 'items-center'); const oldGap = gap(mentions[0]); mentions[0].classList.replace('items-center', 'items-baseline');
        return { corrected, oldGap };
      })()`);
      assert.ok(baselines.corrected.every(gap => gap <= 1), JSON.stringify(baselines));
      assert.ok(baselines.oldGap > 1, `the previous center alignment fails the same baseline measurement: ${JSON.stringify(baselines)}`);
      writeFileSync(`${evidence}/${width}-${scheme}-baselines.json`, JSON.stringify(baselines, null, 2));
      for (const id of ['via-person', 'data-ready', 'pdf-doing', 'pdf-plan']) {
        assert.equal(await browser.evaluate(`${message(id)}.querySelector('[data-slot=bubble]').dataset.variant`), 'muted');
        assert.equal(await browser.evaluate(`${message(id)}.querySelector('[data-slot=bubble]').dataset.align`), 'start');
      }
      assert.equal(await browser.evaluate(`${message(ownId)}.querySelector('[data-slot=bubble]').dataset.align`), 'end');
      assert.equal(await browser.evaluate(`!!${message(ownId)}.querySelector('[data-testid=message-author], [data-testid=message-avatar]')`), false);
      assert.equal(await browser.evaluate(`!!${message('pdf-doing')}.querySelector('[data-testid=message-avatar] [data-slot=avatar]')`), false);
      assert.equal(await browser.evaluate(`!!${message('pdf-plan')}.querySelector('[data-testid=message-author]')`), false);
      assert.equal(await browser.evaluate(`!!${message('pdf-plan')}.querySelector('[data-testid=message-avatar] svg[data-lucide=sparkle]')`), true);
      assert.equal(await browser.evaluate(`!!document.querySelector('[data-testid=transcript] [data-testid=avatar-indicator], [data-testid=transcript] [data-lucide=bot]')`), false, 'clean glyphs, no state dot');
      assert.equal(await browser.evaluate(`!!${q('[data-testid=author-badge]')}`), false);
      const geometry = await browser.evaluate(`(() => {
        const rect = e => e.getBoundingClientRect();
        const info = id => { const row = document.querySelector('[data-shared-message="' + id + '"]'), a = rect(row.querySelector('[data-testid=message-avatar] [data-slot=avatar]')), b = rect(row.querySelector('[data-slot=bubble]')); return { avatar: a.width, bottom: Math.abs(a.bottom - b.bottom), before: a.right <= b.left }; };
        return { person: info('via-person'), agent: info('pdf-plan'), continuationGap: rect(${message('pdf-plan')}).top - rect(${message('pdf-doing')}).bottom };
      })()`);
      for (const author of [geometry.person, geometry.agent]) { assert.equal(author.avatar, 24); assert.ok(author.bottom <= 1); assert.equal(author.before, true); }
      assert.ok(geometry.continuationGap > 0 && geometry.continuationGap <= 8);
      writeFileSync(`${evidence}/${width}-${scheme}-geometry.json`, JSON.stringify(geometry, null, 2));
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=day-separator]')}.map(e => e.textContent)`), ['jeu. 10 sept.', 'Aujourd’hui']);
      await shot('room-overview');

      await browser.evaluate('window.__SHARED__.build()');
      await browser.until('PM owns the trace and card', `!!${trace} && ${qa('[data-testid=request-card]')}.length === 1`);
      assert.equal(await browser.evaluate(`!!${message('pdf-worker')}`), false);
      assert.equal(await browser.evaluate(`document.body.innerText.includes('Builder')`), false);
      assert.equal(await browser.evaluate(`${trace}.dataset.open`), 'false');
      assert.equal(await browser.evaluate(`${qa('[data-slot=spinner]')}.length`), 1);
      assert.equal(await browser.evaluate(`!!${avatar}.querySelector('[data-slot=spinner]')`), false);
      assert.equal(await browser.evaluate(`(() => { const a = ${avatar}.getBoundingClientRect(), c = ${message('pdf-card')}.querySelector('[data-testid=card-bubble]').getBoundingClientRect(); return Math.abs(a.bottom - c.bottom) <= 1; })()`), true, 'avatar aligns with the final request card');
      await reveal('pdf-card'); await shot('pm-working');
      await browser.click(`${trace}.querySelector('button')`);
      await browser.until('expanded steps', `${trace}.querySelectorAll('[data-testid=activity-step]').length === 3`);
      assert.equal(await browser.evaluate(`${qa('[data-slot=spinner]')}.length`), 1);
      assert.equal(await browser.evaluate(`!!${trace}.querySelector('button [data-slot=spinner]')`), false);
      assert.deepEqual(await browser.evaluate(`[...${trace}.querySelectorAll('[data-testid=activity-step]')].map(e => e.dataset.status)`), ['completed', 'completed', 'running']);
      assert.equal(await browser.evaluate(`${trace}.querySelectorAll('[data-testid=step-detail]').length`), 0);
      await browser.click(`${trace}.querySelector('button')`);
      await browser.evaluate('window.__SHARED__.finish()');
      await browser.until('same result card', `${message('pdf-card')}.innerText.includes('On attend votre essai')`);
      assert.equal(await browser.evaluate(`${qa('[data-testid=request-card]')}.length`), 1);
      assert.equal(await browser.evaluate(`${qa('[data-slot=spinner]')}.length`), 0);
      assert.equal(await browser.evaluate(`${trace}.dataset.open`), 'false');
      assert.equal(await browser.evaluate(`${trace}.querySelector('[data-testid=activity-label]').textContent`), '3 étapes');
      assert.equal(await browser.evaluate(`(() => { const c = ${message('pdf-card')}.querySelector('[data-testid=request-card]').getBoundingClientRect(), body = ${message('pdf-card')}.querySelector('[data-testid=shared-message-content]').getBoundingClientRect(); return c.width <= body.width * 0.8 + 1; })()`), true);
      await reveal('pdf-card'); await shot('card-result');
      const actions = `${message('pdf-card')}.querySelector('[data-testid=shared-message-actions]')`;
      assert.equal(await browser.evaluate(device === 'phone' ? `${actions}.hidden` : `getComputedStyle(${actions}).opacity === '0'`), true);
      if (device === 'phone') {
        await browser.evaluate(`${message('pdf-card')}.focus()`);
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F10', code: 'F10', modifiers: 8 });
        await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F10', code: 'F10', modifiers: 8 });
        await browser.until('keyboard exposes phone Reply', `!${actions}.hidden`);
        await browser.press('Escape');
        await browser.until('Escape closes phone actions', `${actions}.hidden`);
      }
      await exposeActions('pdf-card');
      if (device === 'desktop') {
        await browser.hover(q('[data-testid=workspace-bar-title]'));
        await browser.evaluate(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]').focus()`);
        assert.equal(await browser.evaluate(`getComputedStyle(${actions}).opacity`), '1');
      }
      await browser.click(`${message('pdf-card')}.querySelector('[data-testid=request-card] button')`);
      await browser.until('host card action', `window.__SHARED__.actions.at(-1)?.actionId === 'try'`);
      await exposeActions('pdf-card'); await browser.click(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]')`);
      await browser.until('composer quote', `${q('[data-testid=composer-reply]')}?.innerText.includes('Export PDF')`);
      await browser.type(input, '@pm Ajoute la date.'); await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('quoted follow-up', `window.__SHARED__.sends.at(-1)?.replyTo === 'pdf-card' && !!${message('pdf-follow-up')}`);
      const sentId = await browser.evaluate(`'sent-' + window.__SHARED__.sends.at(-1).clientId`);
      await inlineMention(`${message(sentId)}.querySelector('[data-testid=message-mention]')`);
      await browser.click(`${message(sentId)}.querySelector('[data-testid=message-quote] button')`);
      assert.equal(await browser.evaluate(`(() => { const r = ${message('pdf-card')}.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()`), true);
      await browser.click(q('[data-testid=workspace-bar-history]'));
      await browser.until('host conversations', `${qa('[data-testid=conversation-row]')}.length === 3`);
      await pause(600);
      await browser.click(q('[data-testid=conversation-row][data-conversation-id=admin]'));
      // The History sheet closes over the room on a phone; tap the trace once the sheet is gone and the room has settled.
      await browser.until('admin host trace', `!!${message('admin-trace')} && !document.querySelector('[data-testid=conversation-row]')`);
      await pause(300);
      await browser.click(`${message('admin-trace')}.querySelector('[data-testid=activity] button')`);
      await browser.until('admin details', `${message('admin-trace')}.querySelectorAll('[data-testid=step-detail]').length === 3`);
      const contrast = await auditAgentContrast(browser);
      writeFileSync(`${evidence}/${width}-${scheme}-small-text.json`, JSON.stringify(await auditSmallText(browser), null, 2));
      writeFileSync(`${evidence}/${width}-${scheme}-contrast.json`, JSON.stringify(contrast, null, 2));
      assert.equal(await browser.evaluate(noOverflow), true);
      assert.deepEqual(browser.problems, []);
      console.log(`PASS ${width}px ${scheme}: PM/Data chart identity, baseline-aligned mentions, final-card avatars, one spinner, cards and quotes`);
    }
  }
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  assert.equal(await browser.evaluate(noOverflow), true, 'no horizontal overflow at 360px');
  assert.deepEqual(browser.problems, []);
  await browser.close(); browser = undefined;
  writeFileSync(`${evidence}/story-small-text.json`, JSON.stringify(await checkStory(app.url, { evidence }), null, 2));
  writeFileSync(`${evidence}/browser-result.json`, JSON.stringify({ passed: true, fictional: true, widths: [390, 1440], themes: ['light', 'dark'] }, null, 2));
} catch (error) { await browser?.screenshot('last-state.png'); throw error; }
finally { await browser?.close(); await app.close(); }
