import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildPage } from '../../ux/runner/build.mjs';

// Button size="inline" in a row that wraps: the 44px touch area is a ::after that reaches into the room the layout leaves and no further, so two
// buttons never share a pixel and a tap on the box of a button always lands on that button. Real Chromium at 390 touch (and 1280 fine) mounts the
// scenario fixture ux/fixtures/component-inline-actions.jsx: a row that declares its gaps (--inline-gap-x, --inline-gap-y), the same row with
// nothing declared, one button per table cell and one in a sentence. Every sampled point of every button's area (its box plus its ::after) must
// reach that button, the areas of two buttons must be disjoint, an isolated button keeps the full 44px and a declared row reaches it by its gaps.
// In CI a missing browser fails the test; it never skips (D-1731).
const root = fileURLToPath(new URL('../../', import.meta.url));
const FLOOR = 44;

const sweep = `(() => {
  const out = {};
  for (const scope of ['room', 'tight', 'cell1', 'cell2', 'isolated']) {
    const buttons = [...document.querySelectorAll('[data-testid^=' + scope + '-]')].filter(el => el.tagName === 'BUTTON');
    const area = button => {
      const r = button.getBoundingClientRect(), a = getComputedStyle(button, '::after');
      const has = a.content !== 'none' && a.content !== 'normal';
      const w = has ? parseFloat(a.width) : r.width, h = has ? parseFloat(a.height) : r.height, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      return { box: r, x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2, pseudo: has };
    };
    const areas = buttons.map(area), wrong = [];
    areas.forEach((a, i) => {
      for (let y = Math.ceil(a.y0) + 0.5; y < a.y1; y += 2) for (let x = Math.ceil(a.x0) + 0.5; x < a.x1; x += 2) {
        const hit = document.elementFromPoint(x, y)?.closest('button');
        if (hit !== buttons[i]) wrong.push({ button: buttons[i].textContent, x: Math.round(x), y: Math.round(y), landsOn: hit ? hit.textContent : (document.elementFromPoint(x, y)?.tagName ?? null) });
      }
    });
    const shared = [];
    areas.forEach((a, i) => areas.forEach((b, j) => { if (j > i && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) shared.push([buttons[i].textContent, buttons[j].textContent]); }));
    const lines = [...new Set(areas.map(a => Math.round(a.box.top)))].length;
    out[scope] = { count: buttons.length, lines, wrong: wrong.length, firstWrong: wrong.slice(0, 3), shared, areas: areas.map(a => ({ w: Math.round(a.x1 - a.x0), h: Math.round(a.y1 - a.y0), boxH: Math.round(a.box.height), pseudo: a.pseudo })) };
  }
  return out;
})()`;

test('Button size="inline" in a wrapped row: no pixel is claimed by two buttons, a tap on a box lands on that button, the 44px floor holds where there is room', { skip: !process.env.CHROMIUM && !process.env.CI, timeout: 300000 }, async () => {
  assert.ok(process.env.CHROMIUM, 'CHROMIUM must be set when CI is set');
  mkdirSync(join(root, '.cache'), { recursive: true });
  const work = mkdtempSync(join(root, '.cache/button-inline-wrap-'));
  const page = await buildPage('ux/fixtures/component-inline-actions.jsx', join(work, 'page.html'), { title: 'inline actions' });
  await build({ entryPoints: [join(root, 'packages/testing/src/browser.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(work, 'browser.mjs') });
  const { launch } = await import(pathToFileURL(join(work, 'browser.mjs')));
  const browser = await launch('about:blank', { evidence: process.env.EVIDENCE_DIR ?? work });
  const problems = [];
  try {
    for (const [width, mobile] of [[390, true], [1280, false]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1600, deviceScaleFactor: 1, mobile });
      await browser.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
      await browser.send('Page.navigate', { url: pathToFileURL(page).href });
      await browser.until('fixture mounted', `document.querySelectorAll('[data-testid=room-voir]').length === 1 && document.readyState === 'complete'`);
      await new Promise(done => setTimeout(done, 300));
      const m = await browser.evaluate(sweep);
      const check = (ok, message) => { if (!ok) problems.push(`${width}: ${message}`); };
      for (const [scope, r] of Object.entries(m)) {
        check(r.wrong === 0, `${scope}: ${r.wrong} sampled points of a button's own area reach another element, e.g. ${JSON.stringify(r.firstWrong)}`);
        check(r.shared.length === 0, `${scope}: two buttons share a touch area: ${JSON.stringify(r.shared)}`);
      }
      check(m.room.lines === 2 && m.tight.lines === 2, `the rows wrap onto two lines (declared ${m.room.lines}, tight ${m.tight.lines})`);
      if (mobile) {
        check(m.room.areas.every(a => a.h === FLOOR && a.w >= FLOOR), `a row that declares its gaps keeps the ${FLOOR}px floor: ${JSON.stringify(m.room.areas)}`);
        check(m.tight.areas.every(a => a.h === a.boxH), `a row that declares nothing gets no extension beyond the text line: ${JSON.stringify(m.tight.areas)}`);
        for (const scope of ['cell1', 'cell2', 'isolated']) check(m[scope].areas.every(a => a.h === FLOOR && a.w >= FLOOR), `${scope}: an isolated button keeps the ${FLOOR}px floor: ${JSON.stringify(m[scope].areas)}`);
      } else {
        for (const [scope, r] of Object.entries(m)) check(r.areas.every(a => !a.pseudo && a.h === a.boxH), `${scope}: a fine pointer has no extension: ${JSON.stringify(r.areas)}`);
      }
    }
    assert.deepEqual(problems, []);
    assert.deepEqual(browser.problems, []);
  } finally { await browser.close(); }
});
