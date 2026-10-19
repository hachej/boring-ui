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
const avatar = `${message('pdf-plan')}.querySelector('[data-testid=agent-avatar-pm]')`;
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
      await browser.until('the shared composer', `!!${input} && !!${q('[data-testid=shared-members]')}`);
      await browser.evaluate(`document.documentElement.classList.toggle('dark', ${scheme === 'dark'})`);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      const shot = async name => { await pause(250); await browser.screenshot(`${width}-${scheme}-${name}.png`); };
      const reveal = async id => { await browser.evaluate(`${message(id)}.scrollIntoView({ block: 'start', behavior: 'instant' })`); await pause(200); };
      const exposeActions = async id => {
        await reveal(id);
        if (device === 'phone') {
          const point = await browser.evaluate(`(() => { const r = ${message(id)}.querySelector('[data-slot=card-title]').getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await pause(550);
          await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else await browser.hover(message(id));
        await browser.until('the existing inline Reply action is visible', `(() => { const e = ${message(id)}.querySelector('[data-testid=shared-message-actions]'); return !e.hidden && getComputedStyle(e).opacity === '1'; })()`);
      };
      const hint = async (state, line, name) => {
        await reveal('pdf-plan');
        assert.equal(await browser.evaluate(`${avatar}.dataset.state`), state);
        if (device === 'phone') await browser.tap(avatar); else await browser.hover(avatar);
        const popup = q(device === 'phone' ? '[data-slot=popover-content]' : '[data-slot=tooltip-content]');
        await browser.until('avatar card line', `${popup}?.textContent.includes(${JSON.stringify(line)})`);
        if (device === 'phone') {
          assert.equal(await browser.evaluate(`${popup}.getAttribute('data-side')`), 'bottom');
          assert.equal(await browser.evaluate(`(() => { const popup = ${popup}.getBoundingClientRect(), row = ${message('pdf-plan')}.querySelector('[data-testid=message-author-row]').getBoundingClientRect(); return popup.top >= row.bottom - 1 && Math.abs(popup.left - row.left) <= 1; })()`), true, 'state popover is below the avatar/name row, aligned to its start');
        }
        await shot(name);
        if (device === 'phone') {
          await browser.evaluate(`(() => { const e = ${q('[data-testid=transcript-scroll]')}; e.scrollTop += e.scrollTop > 0 ? -20 : 20; })()`);
          await browser.until('scroll closes the state disclosure', `!${q('[data-testid=agent-state-popover]')} || ${q('[data-testid=agent-state-popover]')}.hasAttribute('data-closed')`);
        } else { await browser.press('Escape'); await browser.hover(q('[data-testid=workspace-bar-title]')); }
      };
      assert.equal(await browser.evaluate(`!!${q('[data-testid=sessions-toggle]')}`), false);
      await browser.until('personal-agent message keeps its person author', `!!${message('via-person')}?.querySelector('[data-testid=message-via]')`);
      assert.equal(await browser.evaluate(`${message('via-person')}.querySelector('[data-testid=message-author]').textContent`), 'Leo');
      assert.equal(await browser.evaluate(`${message('via-person')}.querySelector('[data-testid=message-via]').textContent`), 'via Claude');
      assert.equal(await browser.evaluate(`${message('via-person')}.querySelector('[data-testid=message-via]').classList.contains('text-muted-foreground')`), true);
      assert.equal(await browser.evaluate(`!!${message('via-person')}.querySelector('[data-testid=author-badge], [data-testid=avatar-indicator]')`), false);
      if (scheme === 'light') { await reveal('via-person'); await shot('via'); }
      await browser.type(input, '@');
      await browser.until('agents-first mention popover', `${qa('[data-testid=mention-item]')}.length === 5`);
      assert.deepEqual(await browser.evaluate(`${qa('[data-testid=mention-item]')}.map(item => item.dataset.path).slice(0, 2)`), ['pm', 'worker']);
      await shot('mentions-agents');
      await browser.press('ArrowDown'); await browser.press('ArrowUp'); await browser.press('Enter');
      await browser.type(input, 'ajoute un export PDF');
      assert.equal(await browser.evaluate(`${input}.value`), '@pm ajoute un export PDF');
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('summon reaches host with PM id', `window.__SHARED__.sends.at(-1)?.mentions.includes('pm') && !!${message('pdf-plan')}`);
      await browser.evaluate('window.__SHARED__.planReady()');
      await browser.until('two-line plan streams in place', `${message('pdf-plan')}.innerText.includes('Je vérifierai le document')`);
      assert.equal(await browser.evaluate(`${message('pdf-plan')}.querySelector('[data-testid=author-badge]').textContent`), 'Agent');
      assert.equal(await browser.evaluate(`!!${message('pdf-plan')}.querySelector('[aria-label="Copy response"]')`), false);
      await reveal('pdf-plan'); await shot('summon-plan');

      await browser.evaluate('window.__SHARED__.build()');
      await browser.until('one building request card', `${qa('[data-testid=request-card]')}.length === 1 && ${message('pdf-card')}.innerText.includes('Je prépare')`);
      assert.deepEqual(await browser.evaluate(`${message('pdf-plan')}.querySelectorAll('[data-testid=activity-step]') ? [...${message('pdf-plan')}.querySelectorAll('[data-testid=activity-step]')].map(step => step.dataset.status) : []`), ['completed', 'completed', 'running']);
      assert.equal(await browser.evaluate(`${message('pdf-worker')}.querySelectorAll('[data-testid=activity-step]').length`), 1);
      assert.equal(await browser.evaluate(`${message('pdf-plan')}.querySelectorAll('[data-testid=step-detail]').length`), 0, 'the fake host strips detail outside admin');
      await reveal('pdf-plan'); await shot('trace-live');
      await hint('working', 'Je prépare l’export PDF.', 'avatar-working');
      assert.equal(await browser.evaluate(`!!${avatar}.querySelector('[data-slot=spinner]')`), false, 'avatar uses a static corner dot, not a spinner');
      await reveal('pdf-card'); await shot('card-building');

      await browser.evaluate('window.__SHARED__.finish()');
      await browser.until('same card becomes the result', `${message('pdf-card')}.innerText.includes('On attend votre essai')`);
      assert.equal(await browser.evaluate(`${qa('[data-testid=request-card]')}.length`), 1);
      assert.match(await browser.evaluate(`${message('pdf-card')}.innerText`), /Essayer cette version/);
      await reveal('pdf-card'); await shot('card-result');
      const actions = `${message('pdf-card')}.querySelector('[data-testid=shared-message-actions]')`;
      assert.equal(await browser.evaluate(device === 'phone' ? `${actions}.hidden` : `getComputedStyle(${actions}).opacity === '0'`), true, 'Reply does not sit visibly under every message');
      await exposeActions('pdf-card');
      if (device === 'desktop') {
        await browser.hover(q('[data-testid=workspace-bar-title]'));
        await browser.evaluate(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]').focus()`);
        assert.equal(await browser.evaluate(`getComputedStyle(${actions}).opacity`), '1', 'keyboard focus reveals Reply too');
        await browser.evaluate('document.activeElement.blur()');
      }
      assert.equal(await browser.evaluate(`!!${q('[role=menu]')}`), false, 'there is no new message menu');
      await browser.click(`${message('pdf-card')}.querySelector('[data-testid=request-card] button')`);
      await browser.until('the result button calls action only', `window.__SHARED__.actions.at(-1)?.actionId === 'try'`);
      assert.equal(await browser.evaluate(`${trace('pdf-plan')}.dataset.open`), 'false');
      assert.equal(await browser.evaluate(`${trace('pdf-plan')}.querySelector('[data-testid=activity-label]').textContent`), '3 étapes');
      await reveal('pdf-plan'); await shot('trace-collapsed');
      await hint('waiting', 'On attend votre essai', 'avatar-waiting');
      assert.equal(await browser.evaluate(`!!${avatar}.querySelector('[data-slot=spinner]')`), false);
      await reveal('pdf-doing'); await shot('doing-answer');
      assert.match(await browser.evaluate(`${message('pdf-doing')}.innerText`), /Je regarde vos fichiers/);
      assert.equal(await browser.evaluate(`!!${message('pdf-answer')}`), false, 'the fixture does not repeat the card result as a status message');

      await exposeActions('pdf-card');
      await browser.click(`${message('pdf-card')}.querySelector('[data-testid=shared-reply]')`);
      await browser.until('quoted composer chip', `${q('[data-testid=composer-reply]')}?.innerText.includes('Export PDF')`);
      await browser.type(input, 'Ajoute la date au PDF.');
      await shot('quote-composer');
      await browser.click(q('[data-testid=composer-submit]'));
      await browser.until('follow-up carries the parent id', `window.__SHARED__.sends.at(-1)?.replyTo === 'pdf-card' && !!${message('pdf-follow-up')}`);
      const sentId = await browser.evaluate(`'sent-' + window.__SHARED__.sends.at(-1).clientId`);
      assert.match(await browser.evaluate(`${message(sentId)}.querySelector('[data-testid=message-quote]').innerText`), /PM.*Export PDF/);
      await reveal(sentId); await shot('quote-sent');
      await browser.click(`${message(sentId)}.querySelector('[data-testid=message-quote] button')`);
      assert.equal(await browser.evaluate(`(() => { const r = ${message('pdf-card')}.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; })()`), true, 'quote scrolls to its card in the existing timeline');

      await browser.click(q('[data-testid=workspace-bar-history]'));
      await browser.until('History main, admin, direct', `${qa('[data-testid=conversation-row]')}.length === 3`);
      await pause(600); await shot('history');
      await browser.click(q('[data-testid=conversation-row][data-conversation-id=admin]'));
      await browser.until('admin trace', `!!${message('admin-trace')}`);
      await browser.click(`${trace('admin-trace')}.querySelector('button')`);
      await browser.until('expanded admin details', `${message('admin-trace')}.querySelectorAll('[data-testid=step-detail]').length === 3`);
      assert.match(await browser.evaluate(`${message('admin-trace')}.innerText`), /read src\/fictional-export.ts/);
      await shot('admin-trace-expanded');
      assert.equal(await browser.evaluate(noOverflow), true, `${width}: no horizontal overflow`);
      console.log(`PASS ${width}px ${scheme}: summon, plan, one result card, quoted reply, avatar states and per-agent trace`);
    }
  }
  await browser.emulate('phone');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 1, mobile: true });
  await pause(200);
  assert.equal(await browser.evaluate(noOverflow), true, 'no horizontal overflow at 360px');
  assert.equal(await browser.evaluate(`(() => { const e = ${q('[data-testid=transcript-scroll]')}; return e.scrollWidth <= e.clientWidth; })()`), true);
  await browser.screenshot('360-no-overflow.png');
  assert.deepEqual(browser.problems, []);
  writeFileSync(`${evidence}/browser-result.json`, JSON.stringify({ passed: true, round: 2, widths: [390, 1440, 360], themes: ['light', 'dark'], fictional: true }, null, 2));
  console.log(`PASS shared participant browser journey; evidence ${evidence}`);
} catch (error) {
  if (browser) {
    await browser.screenshot('last-state.png');
    writeFileSync(`${evidence}/browser-failure.json`, JSON.stringify(await browser.evaluate(`(() => {
      const row = ${message('pdf-card')}, actions = row?.querySelector('[data-testid=shared-message-actions]'), r = row?.getBoundingClientRect();
      return { hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches, rowHovered: row?.matches(':hover'), rect: r?.toJSON(), atCenter: r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 500), actions: actions && { hidden: actions.hidden, opacity: getComputedStyle(actions).opacity, className: actions.className } };
    })()`).catch(() => null), null, 2));
  }
  throw error;
} finally { await browser?.close(); await app.close(); }
