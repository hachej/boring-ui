import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q, qa } from '@hachej/boring-testing/browser';
import { startSharedChat } from './server.mjs';

const evidence = process.env.SHARED_CHAT_EVIDENCE ?? '.cache/evidence/shared-chat';
mkdirSync(evidence, { recursive: true });
const app = await startSharedChat();
let browser;
const input = q('[data-testid=composer-input]');
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth';
const message = id => q(`[data-shared-message="${id}"]`);
const trace = id => `${message(id)}.querySelector('[data-testid=activity]')`;
const avatar = `${message('pdf-doing')}.querySelector('[data-testid=agent-avatar-pm]')`;
try {
  for (const [device, width, height] of [['phone', 390, 844], ['desktop', 1440, 1000]]) {
    await browser?.close(); browser = undefined;
    // Disabling CDP touch emulation resets hover media; use a fresh mouse-capable profile for desktop.
    browser = await launch(`${app.url}?manual`, { evidence, args: ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'] });
    if (device === 'phone') await browser.emulate(device);
    assert.equal(await browser.evaluate("matchMedia('(hover: hover)').matches"), device === 'desktop');
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: device === 'phone' });
    for (const scheme of ['light', 'dark']) {
      await browser.reload();
      await browser.until('the shared composer', `!!${input} && !!${q('[data-testid=shared-members]')} && !!${message('via-person')}`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${scheme === 'dark'})`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      const shot = async name => { await pause(250); await browser.screenshot(`${width}-${scheme}-${name}.png`); };
      const reveal = async id => { await browser.evaluate(`${message(id)}.scrollIntoView({ block: 'start', behavior: 'instant' })`); await pause(200); };
      const inlineMention = async selector => {
        assert.equal(await browser.evaluate(`${selector}.className`), 'font-medium text-primary');
        assert.equal(await browser.evaluate(`(() => { const e = ${selector}, s = getComputedStyle(e); return s.paddingTop === '0px' && s.paddingRight === '0px' && s.paddingBottom === '0px' && s.paddingLeft === '0px' && s.backgroundColor === 'rgba(0, 0, 0, 0)' && s.lineHeight === getComputedStyle(e.parentElement).lineHeight; })()`), true, 'mentions inherit text rhythm without a padded surface');
      };
      const exposeActions = async id => {
        await reveal(id);
        if (device === 'phone') {
          const point = await browser.evaluate(`(() => { const r = ${message(id)}.querySelector('[data-slot=card-title]').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await pause(550);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await browser.hover(message(id));
        await browser.until('the existing inline Reply action is visible', `(() => { const e = ${message(id)}.querySelector('[data-testid=shared-message-actions]'); return !e.hidden && getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity === '1'; })()`);
      };
      const hint = async (state, line, name) => {
        await reveal('pdf-doing');
        assert.equal(await browser.evaluate(`${avatar}.dataset.state`), state);
        if (device === 'phone') await browser.tap(avatar); else await browser.hover(avatar);
        const popup = q(device === 'phone' ? '[data-slot=popover-content]' : '[data-slot=tooltip-content]');
        await browser.until('avatar card line', `${popup}?.textContent.includes(${JSON.stringify(line)})`);
        if (device === 'phone') assert.equal(await browser.evaluate(`(() => { const popup = ${popup}.getBoundingClientRect(), row = ${message('pdf-doing')}.querySelector('[data-testid=message-author-row]').getBoundingClientRect(); return popup.top >= row.bottom - 1 && Math.abs(popup.left - row.left) <= 1; })()`), true, 'state disclosure is below the author row');
        await shot(name);
        if (device === 'phone') {
          await browser.evaluate(`(() => { const e = ${q('[data-testid=transcript-scroll]')}; e.scrollTop += e.scrollTop > 0 ? -20 : 20; })()`);
          await browser.until('scroll closes the state disclosure', `!${q('[data-testid=agent-state-popover]')} || ${q('[data-testid=agent-state-popover]')}.hasAttribute('data-closed')`);
        } else { await browser.press('Escape'); await browser.hover(q('[data-testid=workspace-bar-title]')); }
      };
      assert.equal(await browser.evaluate(`!!${q('[data-testid=sessions-toggle]')}`), false);
      assert.equal(await browser.evaluate(`!!${q('[data-testid=shared-status]')}`), false, 'no live-status dot');
      assert.equal(await browser.evaluate(`${q('[data-testid=shared-connection-announcement]')}.getAttribute('aria-live')`), 'polite');
      for (const [status, tone] of [['reconnecting', 'text-muted-foreground'], ['offline', 'text-destructive']]) {
        await browser.evaluate(`window.__SHARED__.setStatus('${status}')`);
        await browser.until('connection problem dot', `${q('[data-testid=shared-status]')}?.dataset.status === '${status}'`);
        assert.equal(await browser.evaluate(`${q('[data-testid=shared-status]')}.querySelector('svg').classList.contains('${tone}')`), true);
      }
      await browser.evaluate("window.__SHARED__.setStatus('live')");
      await browser.until('the bar returns to quiet', `!${q('[data-testid=shared-status]')}`);
      const person = message('via-person');
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-testid=message-author]').textContent`), 'Leo');
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-testid=message-via]').textContent`), 'via Claude');
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-testid=message-via]').classList.contains('text-muted-foreground')`), true);
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-testid=member-avatar]').dataset.size`), 'sm');
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-slot=bubble]').dataset.variant`), 'muted');
      assert.equal(await browser.evaluate(`${person}.querySelector('[data-slot=bubble]').dataset.align`), 'start');
      assert.equal(await browser.evaluate(`!!${person}.querySelector('[data-testid=author-badge], [data-testid=avatar-indicator]')`), false);
      assert.equal(await browser.evaluate(`(() => { const row = ${person}, a = row.querySelector('[data-testid=member-avatar]').getBoundingClientRect(), b = row.querySelector('[data-slot=bubble]').getBoundingClientRect(), n = row.querySelector('[data-testid=message-author]').getBoundingClientRect(); return a.width === 24 && ${device === 'desktop' ? 'Math.abs(a.top - b.top) <= 1' : 'Math.abs(a.top + a.height / 2 - n.top - n.height / 2) <= 1'}; })()`), true, 'compact avatar/header alignment');
      if (scheme === 'light') { await reveal('via-person'); await shot('via'); }

      await browser.type(input, '@');
      await browser.until('agents-first mention popover', `${qa('[data-testid=mention-item]')}.length === 5`);
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=mention-item]')}.map(item => item.dataset.path).slice(0, 2)`), ['pm', 'worker']);
      await shot('mentions-agents');
      await browser.press('ArrowDown'); await browser.press('ArrowUp'); await browser.press('Enter');
      await browser.type(input, 'ajoute un export PDF');
      assert.equal(await browser.evaluate(`${input}.value`), '@pm ajoute un export PDF');
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('doing precedes the plan', `window.__SHARED__.sends.at(-1)?.mentions.includes('pm') && !!${message('pdf-doing')} && !!${message('pdf-plan')}`);
      await browser.evaluate('window.__SHARED__.planReady()');
      await browser.until('the completed handoff plan', `${message('pdf-plan')}.innerText.includes('Je confie la mise en page au Builder')`);
      assert.match(await browser.evaluate(`${message('pdf-doing')}.innerText`), /Je regarde vos fichiers/);
      assert.equal(await browser.evaluate(`${message('pdf-doing')}.querySelector('[data-testid=author-badge]').textContent`), 'Agent');
      assert.equal(await browser.evaluate(`!!${message('pdf-plan')}.querySelector('[data-testid=message-author]')`), false, 'same-minute PM continuation');
      assert.equal(await browser.evaluate(`${message('pdf-plan')}.querySelector('[data-slot=bubble]').dataset.variant`), 'ghost');
      assert.equal(await browser.evaluate(`!!${message('pdf-plan')}.querySelector('[aria-label="Copy response"]')`), false);
      const ownId = await browser.evaluate(`'sent-' + window.__SHARED__.sends.at(-1).clientId`);
      await inlineMention(`${message(ownId)}.querySelector('[data-testid=message-mention]')`);
      assert.equal(await browser.evaluate(`(() => { const other = ${person}.querySelector('[data-slot=bubble-content]'), own = ${message(ownId)}.querySelector('[data-slot=bubble-content]'); return other.className === own.className && getComputedStyle(other).backgroundColor === getComputedStyle(own).backgroundColor && getComputedStyle(other).color === getComputedStyle(own).color; })()`), true, 'colleagues reuse the own-user bubble, not a second skin');
      await reveal('pdf-doing'); await shot('summon-plan'); await shot('doing-answer');
      await reveal('via-person'); await shot('conversation');

      await browser.evaluate('window.__SHARED__.build()');
      await browser.until('one building card and one Builder', `${qa('[data-testid=request-card]')}.length === 1 && !!${message('pdf-worker')}`);
      assert.deepEqual(await browser.evaluate(`${qa('[data-shared-message]')}.map(e => e.dataset.sharedMessage).filter(id => id.startsWith('pdf-'))`), ['pdf-doing', 'pdf-plan', 'pdf-card', 'pdf-worker']);
      assert.match(await browser.evaluate(`${message('pdf-worker')}.innerText`), /Je prépare la mise en page du PDF/);
      assert.equal(await browser.evaluate(`${trace('pdf-worker')}.dataset.open`), 'false');
      assert.equal(await browser.evaluate(`${qa('[data-slot=spinner]')}.length`), 1, 'only the working Builder has a spinner');
      assert.equal(await browser.evaluate(`!!${q('[data-testid=request-card]')}.querySelector('[data-slot=spinner]') || !!${avatar}.querySelector('[data-slot=spinner]')`), false);
      await reveal('pdf-card'); await shot('trace-live'); await shot('card-building');
      await browser.click(`${trace('pdf-worker')}.querySelector('button')`);
      await browser.until('expanded Builder trace', `${message('pdf-worker')}.querySelectorAll('[data-testid=activity-step]').length === 3`);
      assert.equal(await browser.evaluate(`${message('pdf-worker')}.querySelectorAll('[data-slot=spinner]').length`), 1);
      assert.deepEqual(await browser.evaluate(`[...${message('pdf-worker')}.querySelectorAll('[data-testid=activity-step]')].map(step => step.dataset.status)`), ['completed', 'completed', 'running']);
      assert.equal(await browser.evaluate(`!!${trace('pdf-worker')}.querySelector('button [data-slot=spinner]')`), false);
      assert.equal(await browser.evaluate(`${message('pdf-worker')}.querySelectorAll('[data-testid=step-detail]').length`), 0, 'host strips detail outside Admin');
      await reveal('pdf-card'); await shot('trace-live-expanded');
      await browser.click(`${trace('pdf-worker')}.querySelector('button')`);
      await hint('working', 'Je prépare l’export PDF.', 'avatar-working');

      await browser.evaluate('window.__SHARED__.finish()');
      await browser.until('same card becomes the result', `${message('pdf-card')}.innerText.includes('On attend votre essai')`);
      assert.equal(await browser.evaluate(`${qa('[data-testid=request-card]')}.length`), 1);
      assert.equal(await browser.evaluate(`${trace('pdf-worker')}.dataset.open`), 'false');
      assert.equal(await browser.evaluate(`${trace('pdf-worker')}.querySelector('[data-testid=activity-label]').textContent`), '3 étapes');
      assert.equal(await browser.evaluate(`${qa('[data-slot=spinner]')}.length`), 0, 'finished has no spinner');
      await reveal('pdf-card'); await shot('card-result'); await shot('trace-collapsed');
      const actions = `${message('pdf-card')}.querySelector('[data-testid=shared-message-actions]')`;
      assert.equal(await browser.evaluate(device === 'phone' ? `${actions}.hidden && getComputedStyle(${actions}).display === 'none'` : `getComputedStyle(${actions}).opacity === '0'`), true);
      await exposeActions('pdf-card');
      if (device === 'desktop') {
        await browser.hover(q('[data-testid=workspace-bar-title]'));
        await browser.evaluate(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]').focus()`);
        assert.equal(await browser.evaluate(`getComputedStyle(${actions}).opacity`), '1');
        await browser.evaluate('document.activeElement.blur()');
      }
      assert.equal(await browser.evaluate(`!!${q('[role=menu]')}`), false, 'no new message menu');
      await browser.click(`${message('pdf-card')}.querySelector('[data-testid=request-card] button')`);
      await browser.until('result button calls action', `window.__SHARED__.actions.at(-1)?.actionId === 'try'`);
      await hint('waiting', 'On attend votre essai', 'avatar-waiting');
      assert.equal(await browser.evaluate(`!!${message('pdf-answer')}`), false, 'no duplicate result-status message');

      await exposeActions('pdf-card'); await browser.click(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]')`);
      await browser.until('quoted composer chip', `${q('[data-testid=composer-reply]')}?.innerText.includes('Export PDF')`);
      await browser.type(input, '@Le');
      await browser.until('Leo mention', `!!${q('[data-testid=mention-item][data-path=leo]')}`);
      await browser.press('Enter'); await browser.type(input, 'Ajoute la date au PDF.');
      await shot('quote-composer'); await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('follow-up carries the parent id', `window.__SHARED__.sends.at(-1)?.replyTo === 'pdf-card' && !!${message('pdf-follow-up')}`);
      const sentId = await browser.evaluate(`'sent-' + window.__SHARED__.sends.at(-1).clientId`);
      assert.match(await browser.evaluate(`${message(sentId)}.querySelector('[data-testid=message-quote]').innerText`), /PM.*Export PDF/);
      await inlineMention(`${message(sentId)}.querySelector('[data-testid=message-mention]')`);
      await reveal(sentId); await shot('quote-sent');
      await browser.click(`${message(sentId)}.querySelector('[data-testid=message-quote] button')`);
      assert.equal(await browser.evaluate(`(() => { const r = ${message('pdf-card')}.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()`), true);
      await browser.click(q('[data-testid=workspace-bar-history]'));
      await browser.until('History main, admin, direct', `${qa('[data-testid=conversation-row]')}.length === 3`);
      await pause(600); await shot('history');
      await browser.click(q('[data-testid=conversation-row][data-conversation-id=admin]'));
      await browser.until('admin trace', `!!${message('admin-trace')}`);
      await browser.click(`${trace('admin-trace')}.querySelector('button')`);
      await browser.until('admin details', `${message('admin-trace')}.querySelectorAll('[data-testid=step-detail]').length === 3`);
      assert.match(await browser.evaluate(`${message('admin-trace')}.innerText`), /read src\/fictional-export.ts/);
      await shot('admin-trace-expanded');
      assert.equal(await browser.evaluate(noOverflow), true);
      console.log(`PASS ${width}px ${scheme}: colleague bubbles, inline mentions, quiet live bar, sequential handoff, one spinner and quotes`);
    }
  }
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  assert.equal(await browser.evaluate(noOverflow), true, 'no horizontal overflow at 360px');
  assert.equal(await browser.evaluate(`(() => { const e = ${q('[data-testid=transcript-scroll]')}; return e.scrollWidth <= e.clientWidth; })()`), true);
  await browser.screenshot('360-no-overflow.png');
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/browser-result.json`, JSON.stringify({ passed: true, scenario: 'colleagues-and-sequential-handoff', widths: [390, 1440, 360], themes: ['light', 'dark'], fictional: true }, null, 2));
} catch (error) {
  await browser?.screenshot('last-state.png'); throw error;
} finally { await browser?.close(); await app.close(); }
