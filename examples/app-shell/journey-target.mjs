// D108: fictional marked meal -> dictation -> the existing native app conversation, without opening its drawer.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startAppShell } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/D108';
mkdirSync(evidence, { recursive: true });
const app = await startAppShell({ directory: mkdtempSync(join(tmpdir(), 'boring-agent-target-')) });
let browser;
const BAR = '[data-testid=agent-target-bar]';
const SPEECH = 'remplace le riz par 150 g de pâtes';
const EXPECTED = `<target>{"meal":"m-42","slot":"lunch"}</target>\n\n${SPEECH}`;
const reviewFailures = [];
const review = (name, check) => { try { check(); } catch (error) { reviewFailures.push(`${name}: ${error.message}`); } };
try {
  browser = await launch(`${app.url}?targets=1#jour`, { evidence, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const real = window.visualViewport, events = new EventTarget(); let height;
    window.__targetBoot = performance.timeOrigin;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: {
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events),
      get height() { return height ?? real.height; }, get width() { return real.width; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; }, get pageTop() { return real.pageTop; }, get pageLeft() { return real.pageLeft; }, get scale() { return 1; }
    } });
    window.__targetViewport = next => { height = next; events.dispatchEvent(new Event('resize')); };
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__microphones = [];
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await open(constraints); window.__microphones.push(stream); return stream; };
  })()` });
  for (const { device, dark } of [{ device: 'phone', dark: false }, { device: 'desktop', dark: false }, { device: 'phone', dark: true }]) {
    if (device === 'phone') await browser.emulate('phone');
    else { await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }); await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
    const previousBoot = await browser.evaluate('window.__targetBoot').catch(() => undefined);
    await browser.reload();
    await browser.until('the fictional meals in a fresh document', `typeof window.__targetViewport === 'function' && window.__targetBoot !== ${JSON.stringify(previousBoot)} && !!${q('[data-testid=meal-m-42]')} && !${q('[data-testid=connecting]')}`, 30000);
    const tap = selector => device === 'phone' ? browser.tap(q(selector)) : browser.click(q(selector));
    if (dark) { await tap('[data-testid=header-action-theme]'); await browser.until('French dark phone', `document.documentElement.classList.contains('dark')`); }
    await tap('[data-testid=meal-m-42]');
    assert.equal(await browser.evaluate('window.__mealTaps'), 1, `${device}: mode off uses the app normally`);
    assert.equal(await browser.evaluate(`!!${q(BAR)}`), false);
    await tap('[data-testid=header-action-target]');
    await browser.until('targeting enabled', `${q('[data-testid=header-action-target]')}?.getAttribute('aria-label') === 'Arrêter de dicter'`);
    await tap('[data-testid=meal-outside]');
    assert.equal(await browser.evaluate('window.__outsideTaps'), 1, `${device}: unmarked actions pass through`);
    assert.equal(await browser.evaluate(`!!${q(BAR)}`), false);
    const before = app.submits.length, reads = app.mealReads();
    await tap('[data-testid=meal-m-42] span');
    await browser.until('recording from the marked tap', `${q(BAR)}?.dataset.phase === 'recording'`);
    assert.equal(await browser.evaluate('window.__mealTaps'), 1, 'targeting did not activate the meal');
    await browser.evaluate('window.__targetViewport(440)');
    await browser.until('bar above the keyboard', `${q(BAR)}.getBoundingClientRect().bottom <= 440`);
    assert.ok(await browser.evaluate(`(() => { const r = ${q(BAR)}.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0; })()`));
    assert.deepEqual(await browser.evaluate(`[...${q(BAR)}.querySelectorAll('button')].filter(button => { const r = button.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(button => button.textContent)`), []);
    const recording = await browser.evaluate(`(() => { const bar = ${q(BAR)}, meal = ${q('[data-testid=meal-m-42]')}, b = bar.getBoundingClientRect(), m = meal.getBoundingClientRect();
      const probe = document.createElement('span'); probe.style.color = 'var(--border)'; document.body.append(probe); const border = getComputedStyle(probe).color; probe.remove();
      return { title: bar.getAttribute('aria-label'), text: bar.textContent, stop: ${q('[data-testid=agent-target-stop]')}.textContent, cancel: ${q('[data-testid=agent-target-close]')}.textContent,
        width: b.width, left: b.left, itemWidth: m.width, itemLeft: m.left, footerBorder: getComputedStyle(bar.querySelector('[data-slot=card-footer]')).borderTopColor, border,
        dataBadge: !!document.querySelector('[data-testid=tab-donnees] [data-testid=nav-badge]') }; })()`);
    review(`${device} French labels`, () => { assert.equal(recording.title, 'Parler de cet élément'); assert.match(recording.text, /J’écoute… \d+ s/); assert.equal(recording.stop, 'Arrêter et envoyer'); assert.equal(recording.cancel, 'Annuler'); });
    review(`${device} anchor geometry`, () => { assert.ok(Math.abs(recording.width - recording.itemWidth) <= 1, JSON.stringify(recording)); assert.ok(Math.abs(recording.left - recording.itemLeft) <= 1); });
    review(`${device} border token`, () => assert.equal(recording.footerBorder, recording.border));
    if (device === 'phone') review('no fabricated data status badge', () => assert.equal(recording.dataBadge, false));
    if (!dark) await browser.screenshot(`${device}-target-recording.png`);
    await pause(400);
    await tap('[data-testid=agent-target-stop]');
    await browser.until('the exact native answer and refresh', `window.__targetSettled?.length === 1 && ${q('[data-testid=meals]')}?.dataset.refetches === '2'`, 30000);
    assert.equal(app.submits.length, before + 1, 'exactly one native send');
    assert.equal(app.submits.at(-1).agent, 'coach');
    assert.equal(JSON.stringify(app.submits.at(-1).body).includes('not-sent'), false);
    assert.ok(JSON.stringify(app.submits.at(-1).body).includes(JSON.stringify(EXPECTED).slice(1, -1)), JSON.stringify(app.submits.at(-1).body));
    assert.equal(app.mealReads(), reads + 1, 'onSettled performed one actual list refetch');
    assert.deepEqual(await browser.evaluate('window.__targetSettled[0]'), { target: { meal: 'm-42', slot: 'lunch' }, reply: 'Le repas fictif est mis à jour : 150 g de pâtes à la place du riz.', ok: true });
    assert.equal(await browser.evaluate('window.__microphones.every(stream => stream.getTracks().every(track => track.readyState === "ended"))'), true, 'all microphone tracks released');
    assert.ok(await browser.evaluate(`!${q('[data-testid=agent-layer]')} || ${q('[data-testid=agent-layer]')}?.dataset.state === 'closed'`), 'chat stayed closed');
    await browser.evaluate('window.__targetViewport(undefined)');
    const replyStyle = await browser.evaluate(`(() => { const reply = ${q('[data-testid=agent-target-reply]')}; const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--secondary)'; document.body.append(probe); const secondary = getComputedStyle(probe).backgroundColor; probe.remove(); return { background: getComputedStyle(reply).backgroundColor, secondary, close: ${q('[data-testid=agent-target-close]')}.textContent }; })()`);
    review(`${device} secondary reply and French close`, () => { assert.equal(replyStyle.background, replyStyle.secondary); assert.equal(replyStyle.close, 'Fermer'); });
    await browser.screenshot(dark ? 'phone-target-reply-fr-dark.png' : `${device}-target-reply.png`);
    await tap('[data-testid=agent-target-close]');
    await browser.until('bar closed', `!${q(BAR)}`);
    await tap('[data-testid=header-action-target]');
    await browser.until('targeting disabled', `${q('[data-testid=header-action-target]')}?.getAttribute('aria-label') === 'Pointer et dicter'`);
    await tap('[data-testid=meal-m-42]');
    assert.equal(await browser.evaluate('window.__mealTaps'), 2, 'mode off restored normal taps');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'no horizontal overflow');
    console.log(`ok ${device}: marked ancestor, one contextual send, exact reply, refetch, closed drawer, cleanup and normal taps`);
  }
  assert.deepEqual(reviewFailures, [], 'screenshot review regressions');
  assert.deepEqual(browser.problems.filter(problem => !/Failed to load resource/.test(problem)), [], 'no page problems');
} catch (error) {
  if (browser?.problems.length) console.error(browser.problems.join('\n'));
  throw error;
} finally { await browser?.close(); await app.close(); }
