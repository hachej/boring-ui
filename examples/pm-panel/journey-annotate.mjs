// Fail-first regression: point at an ordinary, structurally rich app card through AppShell, not captureElement directly.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, pause, q } from '@hachej/boring-testing/browser';
import { startPmPanel } from './server.mjs';

const evidence = process.env.PM_EVIDENCE ?? '.cache/evidence/pm-one/annotate';
mkdirSync(evidence, { recursive: true });
const rows = process.env.PM_CASE === 'rows';
const app = await startPmPanel();
let browser;
const pins = `[...document.querySelectorAll('[data-feedback-overlay]')].flatMap(host => [...(host.shadowRoot?.querySelectorAll('.label') ?? [])]).filter(label => getComputedStyle(label).display !== 'none').map(label => label.textContent)`;
try {
  browser = await launch('about:blank', { evidence });
  for (const device of ['desktop', 'phone']) {
    await browser.emulate(device);
    if (device === 'desktop') await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: app.url });
    await browser.until('app card', `!!${q('[data-testid=card-a]')}`);
    const press = selector => device === 'phone' ? browser.tap(q(selector)) : browser.click(q(selector));
    await press(device === 'phone' ? '[data-testid=account-button]' : '[data-testid=nav-user]');
    await browser.until('account menu settled', `!!${q('[data-testid=account-improve]')}?.checkVisibility({ visibilityProperty: true })`);
    await pause(400);
    await press('[data-testid=account-improve]');
    await browser.until('point control', `!!${q('[data-testid=pm-show]')}`);
    // One small visible card, like a rendered chart: >50 DOM nodes, not a huge viewport or a fabricated transport failure.
    await browser.evaluate(`(() => {
      const card = ${q('[data-testid=card-a]')};
      if (${rows}) {
        card.removeAttribute('role'); card.setAttribute('aria-label', 'Repas fictifs');
        card.innerHTML = '<details data-testid="meal-a"><summary><b>Déjeuner fictif</b></summary><p>Détail fictif A</p></details><details data-testid="meal-b"><summary><b>Dîner fictif</b></summary><p>Détail fictif B</p></details>';
      } else {
        card.setAttribute('aria-label', 'Carte de repas fictive');
        const detail = document.createElement('span');
        detail.setAttribute('data-testid', 'rich-card-detail');
        for (let i = 0; i < 70; i++) detail.appendChild(document.createElement('span'));
        card.appendChild(detail);
      }
    })()`);
    await press('[data-testid=pm-show]');
    await browser.until('point strip', `!!${q('[data-testid=pm-strip]')} && ${q('[data-testid=pm-strip]')}.getClientRects().length > 0`);
    await press(rows ? '[data-testid=meal-a] summary b' : '[data-testid=card-a]');
    try {
      await browser.until('a pin on the complex card', `${pins}.includes('1')`, 2500);
      if (device === 'desktop') await browser.until('desktop comment popover', `!!${q('[data-testid=pm-comment-input]')} && document.activeElement === ${q('[data-testid=pm-comment-input]')}`, 2500);
    } catch (error) {
      await browser.screenshot(`${device}-missing-pin.png`);
      writeFileSync(`${evidence}/${device}-failure.txt`, await browser.evaluate('document.body.innerText'));
      throw error;
    }
    if (rows) {
      if (device === 'desktop') {
        await browser.type(q('[data-testid=pm-comment-input]'), 'Premier repas fictif');
        await press('[data-testid=pm-comment-add]');
        await press('[data-testid=pm-comment-input]');
        await browser.press('Enter');
      }
      await press('[data-testid=meal-b] summary b');
      await browser.until('different native summary rows keep two pins', `JSON.stringify(${pins}) === '["1","2"]'`, 2500);
      if (device === 'desktop') {
        await browser.type(q('[data-testid=pm-comment-input]'), 'Deuxième repas fictif');
        await browser.press('Enter');
      }
    }
    await browser.screenshot(`${device}-pin.png`);
    const before = app.submits.length;
    if (device === 'desktop' && !rows) {
      await browser.type(q('[data-testid=pm-comment-input]'), 'Agrandir cette carte fictive');
      await browser.press('Enter');
    } else {
      await press('[data-testid=pm-done]');
      await browser.until('review chip', `!!${q('[data-testid=pm-chip]')}`);
      await press('[data-testid=composer-submit]');
    }
    // The HTTP handler records this actual native-chat admission, not a direct controller invocation.
    await browser.until('sent pin row', `!!${q('[data-testid=pm-sent-message]')}`, 12000);
    assert.equal(app.submits.length, before + 1, `${device}: one native submission`);
    const sent = app.submits.at(-1).body;
    const text = typeof sent.content === 'string' ? sent.content : sent.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert.match(text ?? JSON.stringify(sent), /pm\.points@1/);
    assert.match(JSON.stringify(sent), rows ? /Déjeuner fictif/ : /Carte de repas fictive/);
    assert.match(JSON.stringify(sent), /image\/png/);
    await browser.screenshot(`${device}-sent.png`);
  }
  assert.deepEqual(browser.problems, []);
  console.log('PASS: rich-card pin, desktop comment, phone review and one native image submission each');
} catch (error) {
  await browser?.screenshot('failure.png');
  throw error;
} finally { await browser?.close(); await app.close(); }
