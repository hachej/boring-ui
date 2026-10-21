// Real-browser journey of the 0.4.3 gaps (scripted model, no key), embedded layout: the bar keeps a fixed app title with the conversation
// title after it (hidden on a phone), a maquette opened from the Library draws its viewer instead of raw JSON, and French artifact cards
// use translated types and one icon-only action cue, with their open state exposed on desktop and phone.
// Screenshots at 1440 and 390, light and dark, go to .cache/evidence/gaps/.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insecureUrl, launch, pause, q } from '@hachej/boring-testing/browser';

process.env.STUDIO_MODEL = 'scripted';
const { startWorkspaceApp } = await import('./server.mjs');
const evidence = process.env.APP_EVIDENCE ?? '.cache/evidence/gaps';
mkdirSync(evidence, { recursive: true });
const step = async (name, run) => { const started = Date.now(); await run(); console.log(`ok  ${name} (${Date.now() - started} ms)`); };
const INPUT = q('[data-testid=composer-input]');
const noOverflow = `document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth`;
const scheme = value => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const shoot = async name => { for (const value of ['light', 'dark']) { await scheme(value); await pause(250); await browser.screenshot(`${name}-${value}.png`); } await scheme('light'); };
const desktop = async () => { await browser.emulate('desktop'); await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300); };
const libraryPick = async (tap, path) => {
  await (tap ? browser.tap : browser.click)(q('[data-testid=workspace-bar-library]'));
  const row = q(`[data-testid=workspace-library] [role=treeitem][data-path="${path}"] button`);
  await browser.until('the Library lists the file', `!!${row}`, 10000);
  await pause(700);
  await (tap ? browser.tap : browser.click)(row);
};

const oneMenuAndSelectedCase = async (tap, name) => {
  const click = tap ? browser.tap : browser.click;
  assert.equal(await browser.evaluate(`!!${q('[data-testid=maquette-menu]')}`), false, 'no second "…" menu beside the counter');
  await click(q('[data-testid=artifact-more]'));
  await browser.until('the panel menu lists How it works', `!!${q('[data-testid=maquette-how-open]')}`, 5000);
  await click(q('[data-testid=maquette-how-open]'));
  await browser.until('the How it works dialog', `!!${q('[data-testid=maquette-case]')}`, 5000);
  await click(q('[data-testid=maquette-case]'));
  await pause(300);
  await shoot(`${name}-how-selected`);
  await browser.press('Escape');
  await browser.until('the dialog closed', `!${q('[data-testid=maquette-how]')}`, 5000);
};

const app = await startWorkspaceApp({ directory: mkdtempSync(join(tmpdir(), 'boring-gaps-')) });
let browser;
try {
  browser = await launch(`${insecureUrl(app.url)}?embedded&title=Fictional%20bookings`, { evidence });
  await browser.until('the chat is live', `!!${INPUT} && !${INPUT}.disabled`, 20000);
  await desktop();
  await browser.type(INPUT, 'Make the booking mock-up and present it.'); await browser.press('Enter');
  await browser.until('the mock-up is presented', `${q('[data-testid=artifact-card][data-state=ready]')}?.dataset.artifactKind === 'Mock-up'`, 30000);

  await step('1440: the bar keeps the app title; the conversation title follows it, muted', async () => {
    await browser.until('the conversation has a title', `!!${q('[data-testid=workspace-bar-conversation]')}`, 15000);
    assert.equal(await browser.evaluate(`${q('[data-testid=workspace-bar-title]')}.textContent`), 'Fictional bookings');
    assert.ok((await browser.evaluate(`${q('[data-testid=workspace-bar-conversation]')}.textContent`)).length > 0);
    assert.ok(await browser.evaluate(noOverflow));
    await shoot('desktop-bar-title');
  });

  await step('1440: a maquette opened from the Library draws its viewer, not raw JSON', async () => {
    await libraryPick(false, 'booking.maquette.json');
    await browser.until('the maquette viewer', `!!${q('[data-testid=maquette-walk]')}`, 10000);
    assert.equal(await browser.evaluate(`${q('[data-testid=file-preview]')}`), null);
    await shoot('desktop-library-maquette');
    await oneMenuAndSelectedCase(false, 'desktop-library-maquette');
  });

  await step('390: the bar keeps the app title and leaves the conversation to History; the Library opens the maquette', async () => {
    await browser.emulate('phone');
    await browser.send('Page.navigate', { url: `${insecureUrl(app.url)}?embedded&title=Fictional%20bookings` });
    await browser.until('the bar', `!!${q('[data-testid=workspace-bar-conversation]')}`, 20000);
    await pause(500);
    assert.equal(await browser.evaluate(`${q('[data-testid=workspace-bar-title]')}.textContent`), 'Fictional bookings');
    assert.equal(await browser.evaluate(`getComputedStyle(${q('[data-testid=workspace-bar-conversation]')}).display`), 'none');
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    await shoot('phone-bar-title');
    await browser.tap(q('[data-testid=workspace-bar-history]'));
    await browser.until('History lists the conversations', `!!${q('[data-testid=workspace-history] [data-testid=conversation-row]')}`, 10000);
    await shoot('phone-history');
    await browser.press('Escape');
    await browser.until('History closed', `!${q('[data-testid=workspace-history]')}`, 5000);
    await libraryPick(true, 'booking.maquette.json');
    await browser.until('the maquette viewer', `!!${q('[data-testid=maquette-walk]')}`, 10000);
    assert.ok(await browser.evaluate(noOverflow), 'no horizontal scroll at 390');
    await shoot('phone-library-maquette');
    await oneMenuAndSelectedCase(true, 'phone-library-maquette');
  });

  await step('French artifact cards: quiet type labels, one action cue and accessible open state at 1440 and 390', async () => {
    await desktop();
    await browser.send('Page.navigate', { url: `${insecureUrl(app.url)}?embedded&locale=fr` });
    await browser.until('the French chat is live', `!!${INPUT} && !${INPUT}.disabled && /Écrivez/.test(${INPUT}.placeholder)`, 20000);
    await browser.type(INPUT, 'Prépare le guide HTML fictif et présente-le.'); await browser.press('Enter');
    const card = q('[data-testid=artifact-card][data-artifact-type=html][data-state=ready]');
    await browser.until('the French HTML card', `!!${card} && ${card}.getAttribute('aria-pressed') === 'true'`, 30000);
    const check = async open => {
      const state = await browser.evaluate(`(() => { const e = ${card}; return { text: e.textContent, type: e.querySelector('[data-testid=artifact-type]').textContent,
        name: e.getAttribute('aria-label'), pressed: e.getAttribute('aria-pressed'), hint: !!e.querySelector('[data-testid=artifact-hint]'),
        check: !!e.querySelector('svg.lucide-check'), chevron: !!e.querySelector('svg.lucide-chevron-right'), icons: e.querySelectorAll('svg').length,
        width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }; })()`);
      assert.equal(state.type, 'Page HTML');
      assert.equal(state.name, 'Ouvrir Dossier — Écritures et documents fictifs.html');
      assert.equal(state.pressed, String(open));
      assert.doesNotMatch(state.text, /Ouvrir|Open|HTML page/);
      assert.equal(state.hint, false);
      assert.equal(state.check, open); assert.equal(state.chevron, !open); assert.equal(state.icons, 2);
      assert.ok(state.height >= 48 && state.width >= 48, `48px target: ${JSON.stringify(state)}`);
      assert.ok(await browser.evaluate(noOverflow), 'no horizontal page scroll');
    };
    await check(true);
    assert.equal(await browser.evaluate(`${q('[data-testid=artifact-panel-type]')}.textContent`), 'Page HTML');
    await shoot('artifact-card-desktop-open');
    await browser.click(q('[data-testid=artifact-close]'));
    await browser.until('closed card', `${card}.getAttribute('aria-pressed') === 'false'`, 5000);
    await check(false); await shoot('artifact-card-desktop-closed');
    await browser.evaluate(`${card}.focus()`); await browser.press('Enter');
    await browser.until('keyboard opens the same artifact', `${card}.getAttribute('aria-pressed') === 'true' && !!${q('[data-testid=artifact-panel]')}`, 5000);
    await browser.click(q('[data-testid=artifact-close]'));
    await browser.emulate('phone'); await pause(400);
    await check(false); await shoot('artifact-card-phone-closed');
    await browser.tap(card);
    await browser.until('phone opens the card in its sheet', `${q('[data-testid=workspace-panel]')}?.dataset.sheet === 'true' && ${card}.getAttribute('aria-pressed') === 'true'`, 10000);
    await check(true); await shoot('artifact-card-phone-open');
    await browser.tap(q('[data-testid=artifact-close]'));
    await browser.until('phone returns to its closed card', `${card}.getAttribute('aria-pressed') === 'false'`, 5000);
    await check(false);

    // The workspace sheet covers its open card on a phone. The existing component showcase also records that card's selected styling unobscured.
    await browser.send('Page.navigate', { url: `${insecureUrl(app.url)}?controls=artifacts` });
    const preview = q('[data-testid=artifact-card]');
    await browser.until('standalone French card', `${preview}?.getAttribute('aria-pressed') === 'false'`, 10000);
    await shoot('artifact-card-phone-closed-detail');
    await browser.tap(preview);
    await browser.until('standalone selected card', `${preview}.getAttribute('aria-pressed') === 'true' && !!${preview}.querySelector('svg.lucide-check')`, 5000);
    await shoot('artifact-card-phone-open-detail');
  });
  assert.deepEqual(browser.problems, [], 'no page errors');
} finally {
  await browser?.close();
  await app.close();
}
