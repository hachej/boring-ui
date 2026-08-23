import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: false });
await page.goto('http://127.0.0.1:4185/?consoleSpike=1', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.screenshot({ path: '.handoff/console-current-app-spike.png', fullPage: false });
// touch/coarse viewport check
const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await touch.goto('http://127.0.0.1:4185/?consoleSpike=1', { waitUntil: 'load' });
await touch.waitForTimeout(2000);
const sizes = await touch.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel, h: Math.round(r.height), w: Math.round(r.width) };
  };
  return [
    pick('[data-boring-workspace-part="app-left-console-spike"] .app-left-project-row'),
    pick('[data-boring-workspace-part="app-left-console-spike"] .app-left-agent-row'),
    pick('[data-boring-workspace-part="app-left-console-spike"] .app-left-session-row'),
    pick('.app-left-project-disclosure-action'),
  ].filter(Boolean);
});
console.log(JSON.stringify(sizes, null, 1));
await touch.screenshot({ path: '/tmp/console-touch.png' });
await browser.close();
