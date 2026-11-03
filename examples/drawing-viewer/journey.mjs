// The drawing viewer in real Chromium (D-1398): the fictional Excalidraw and draw.io fixtures through the public block, beside each tool's
// own rendering (screenshots for comparison), the parse each renderer read, the inline error, that nothing in a file runs and that no
// request leaves the app's origin, with the app serving Excalidraw's fonts and without them.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, pause } from '@hachej/boring-testing/browser';
import { startDrawings } from './server.mjs';

const evidence = resolve(process.env.APP_EVIDENCE ?? '.cache/evidence/drawing-viewer');
mkdirSync(evidence, { recursive: true });
const report = { steps: [] };
const app = await startDrawings();
let browser;
const step = async (name, run) => {
  const item = { name }; report.steps.push(item);
  try { await run(); item.status = 'passed'; console.log(`PASS ${name}`); }
  catch (error) { item.status = 'failed'; item.error = String(error.stack ?? error); throw error; }
};
const ev = body => browser.evaluate(`(async () => { ${body} })()`);
const open = async query => {
  await browser.send('Page.navigate', { url: `${app.url}${query}` });
  await browser.until('page', `!!document.querySelector('[data-boring=drawing-viewer]')`, 30000);
};
const drawn = (selector, count) => browser.until(`${count} drawn in ${selector}`,
  `document.querySelectorAll('${selector} [data-boring=drawing-viewer][data-state=drawn] img[data-testid=drawing-image]').length >= ${count}
   && [...document.querySelectorAll('${selector} img[data-testid=drawing-image]')].every(img => img.complete && img.naturalWidth > 0)`, 60000);
const parsed = name => ev(`return window.__drawings.read[${JSON.stringify(name)}] ?? null;`);
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
/** Distance from a point to the outline of an axis-aligned box. */
const toOutline = ([x, y], box) => {
  const inside = x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  const dx = Math.max(box.x - x, 0, x - (box.x + box.width)), dy = Math.max(box.y - y, 0, y - (box.y + box.height));
  return inside ? Math.min(x - box.x, box.x + box.width - x, y - box.y, box.y + box.height - y) : Math.hypot(dx, dy);
};
/** Distance from a point to an ellipse's outline, approximately (radial). */
const toEllipse = ([x, y], box) => {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, rx = box.width / 2, ry = box.height / 2;
  const angle = Math.atan2((y - cy) / ry, (x - cx) / rx);
  return Math.hypot(x - (cx + rx * Math.cos(angle)), y - (cy + ry * Math.sin(angle)));
};

try {
  browser = await launch('about:blank', { evidence });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  await step('an Excalidraw file is drawn by Excalidraw on a white page, beside the Excalidraw editor', async () => {
    await open('?only=oakfield-garden.excalidraw&native');
    await drawn('[data-testid="row-oakfield-garden.excalidraw"]', 1);
    await browser.until('native editor', `!!document.querySelector('[data-testid=native-excalidraw] canvas')`, 60000);
    await pause(1500);
    const image = await ev(`const img = document.querySelector('[data-testid="block-oakfield-garden.excalidraw"] img'); return { src: img.src.slice(0, 5), width: img.naturalWidth, height: img.naturalHeight, alt: img.alt };`);
    assert.equal(image.src, 'blob:', 'the drawing is an image from a blob URL');
    assert.ok(image.width > 500 && image.height > 400, `fitted to the shapes: ${image.width}×${image.height}`);
    assert.match(image.alt, /^Excalidraw drawing: \d+ shapes, 3 arrows$/);
    const svg = await ev(`const r = await fetch(document.querySelector('[data-testid="block-oakfield-garden.excalidraw"] img').src); return r.text();`);
    assert.match(svg, /fill="#ffffff"/i, 'a white page');
    assert.match(svg, /@font-face[\s\S]*Excalifont[\s\S]*url\(["']?data:/, 'Excalidraw inlined its own font, served by the app');
    assert.match(svg, /Vegetable beds/); assert.doesNotMatch(svg, /<script/i);
    writeFileSync(resolve(evidence, 'oakfield-garden.block.svg'), svg);
    await browser.screenshot('excalidraw-block-vs-native-1440.png');
  });

  await step('a draw.io file is drawn by the diagrams.net viewer on a white page, beside draw.io\'s own embed', async () => {
    await open('?only=bakery-morning.drawio&native');
    await drawn('[data-testid="row-bakery-morning.drawio"]', 1);
    for (let tries = 0; !(await browser.frameEvaluate(`document.querySelector('[data-testid=native-drawio]')`, `!!document.querySelector('.mxgraph svg')`).catch(() => false)); tries++) {
      assert.ok(tries < 100, 'draw.io\'s own embed drew the file'); await pause(300);
    }
    await pause(1000);
    assert.equal(await ev(`return document.querySelectorAll('[data-boring=drawio-frame]').length;`), 0, 'the renderer frame is gone once it answered');
    const svg = await ev(`const r = await fetch(document.querySelector('[data-testid="block-bakery-morning.drawio"] img').src); return r.text();`);
    assert.match(svg, /^<svg[\s\S]*Kitchen[\s\S]*Bake/, 'the labels are drawn');
    assert.match(svg, /#dae8fc/i, 'the container keeps its fill'); assert.match(svg, /#b85450/i, 'the ellipse keeps its stroke');
    assert.doesNotMatch(svg, /<script|onerror=/i, 'the label\'s script and handler were sanitised away');
    writeFileSync(resolve(evidence, 'bakery-morning.block.svg'), svg);
    await browser.screenshot('drawio-block-vs-native-1440.png');
  });

  await step('the parse: shapes with kind, place, size, label and colours, and the from/to of each arrow', async () => {
    await open('');
    await drawn('main', 3);
    await browser.until('every parse', `['oakfield-garden.excalidraw', 'bakery-morning.drawio', 'bakery-morning-plain.drawio'].every(name => window.__drawings.read[name])`, 60000);
    const garden = await parsed('oakfield-garden.excalidraw');
    const shape = id => garden.shapes.find(entry => entry.id === id);
    assert.equal(garden.format, 'excalidraw');
    assert.deepEqual(garden.shapes.map(entry => entry.kind).sort(), ['diamond', 'ellipse', 'freedraw', 'rectangle', 'text', 'text']);
    assert.deepEqual({ ...shape('beds'), parent: undefined }, { id: 'beds', kind: 'rectangle', x: 40, y: 60, width: 220, height: 110, label: 'Vegetable beds', stroke: '#1e1e1e', fill: '#b2f2bb', parent: undefined });
    assert.equal(shape('pond').label, 'Rain pond'); assert.equal(shape('gate').label, 'Gate?');
    assert.equal(shape('old-shed'), undefined, 'a deleted element is left out');
    assert.ok(!garden.shapes.some(entry => entry.id.endsWith('-label')), 'a container\'s text is its label, not a shape');
    assert.match(shape('unsafe').label, /^<script>.*<\/script> stays text$/, 'script-shaped text stays text');
    const water = garden.arrows.find(entry => entry.id === 'water-path');
    assert.deepEqual([water.kind, water.from, water.to, water.label], ['arrow', 'pond', 'beds', 'Watering']);
    assert.ok(toEllipse(water.points[0], shape('pond')) < 6, `the arrow starts on the pond's outline: ${water.points[0]}`);
    assert.ok(toOutline(water.points.at(-1), shape('beds')) < 6, `and ends on the beds' outline: ${water.points.at(-1)}`);
    assert.deepEqual(garden.arrows.find(entry => entry.id === 'fence').kind, 'line');
    const tilted = garden.arrows.find(entry => entry.id === 'tilted').points;
    assert.ok(near(tilted[0][0], 700, 0.5) && near(tilted[0][1], 50, 0.5) && near(tilted[1][0], 700, 0.5) && near(tilted[1][1], 150, 0.5), `a turned line at its drawn ends: ${JSON.stringify(tilted)}`);

    const bakery = await parsed('bakery-morning.drawio');
    const cell = id => bakery.shapes.find(entry => entry.id === id);
    const edge = id => bakery.arrows.find(entry => entry.id === id);
    assert.equal(bakery.format, 'drawio');
    assert.deepEqual(bakery.shapes.map(entry => entry.id).sort(), ['check', 'dough', 'kitchen', 'logo', 'oven', 'shelf', 'shelf-group', 'sign']);
    assert.deepEqual([cell('kitchen').kind, cell('oven').kind, cell('check').kind, cell('shelf').kind], ['swimlane', 'ellipse', 'rhombus', 'cylinder3']);
    assert.deepEqual([cell('dough').x, cell('dough').y, cell('dough').width, cell('dough').height], [70, 90, 120, 60], 'a vertex in a container at its absolute place');
    assert.deepEqual([cell('dough').label, cell('dough').parent, cell('dough').fill, cell('dough').stroke], ['Mix dough', 'kitchen', '#fff2cc', '#d6b656'], 'HTML stripped from the label');
    assert.deepEqual([cell('shelf').parent, cell('shelf').x, cell('shelf').y], ['shelf-group', 420, 390], 'a vertex in a group');
    assert.equal(cell('sign').label, 'Fresh & warm', 'the label\'s text without its markup or script');
    assert.deepEqual([edge('to-oven').from, edge('to-oven').to, edge('to-oven').label], ['dough', 'oven', 'rest 1 h']);
    assert.ok(edge('to-oven').points.some(([x, y]) => near(x, 130, 1) && near(y, 245, 1)), `the bend point at its absolute place: ${JSON.stringify(edge('to-oven').points)}`);
    assert.equal(edge('to-check').label, '25 min', 'an edge label child is the edge\'s label');
    assert.deepEqual([edge('to-logo').kind, edge('to-check').kind], ['line', 'arrow'], 'a plain line is a line');
    const refused = await ev(`return window.__drawings.blocked['bakery-morning.drawio'];`);
    assert.ok(refused.some(entry => entry.includes('fictional.invalid')), `the frame refused the remote image and said so: ${JSON.stringify(refused)}`);
    assert.ok(toOutline(edge('to-shelf').points[0], cell('check')) < 2 && toOutline(edge('to-shelf').points.at(-1), cell('shelf')) < 2, 'the edge starts and ends on the outlines');
    assert.ok(toOutline(edge('to-oven').points[0], cell('dough')) < 2 && toEllipse(edge('to-oven').points.at(-1), cell('oven')) < 3, 'from the box to the ellipse\'s outline');
    assert.deepEqual(await parsed('bakery-morning-plain.drawio'), { ...bakery }, 'the plain file reads as the compressed one');
    writeFileSync(resolve(evidence, 'parse.json'), JSON.stringify({ garden, bakery }, null, 2));
  });

  await step('an unreadable file shows an inline error; nothing from a file runs; no request leaves the app', async () => {
    const errors = await ev(`return [...document.querySelectorAll('[data-testid=drawing-error]')].map(alert => [alert.dataset.reason, alert.textContent]);`);
    assert.deepEqual(errors.map(([reason]) => reason), ['unreadable', 'unreadable']);
    assert.match(errors[0][1], /This drawing cannot be shown/);
    await pause(1000);
    const state = await ev(`return { pwned: window.__drawings.pwned, violations: window.__drawings.violations, foreign: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => !name.startsWith(location.origin) && !/^(data|blob):/.test(name)) };`);
    assert.deepEqual(state.pwned, [], 'no script or handler from a file ran');
    assert.deepEqual(state.foreign, [], 'no request to another origin');
    assert.deepEqual(state.violations, [], 'and none attempted');
    assert.ok(app.requests.some(path => path.startsWith('/excalidraw/fonts/Excalifont/')), 'Excalidraw\'s fonts came from the app');
    await ev(`document.querySelector('[data-testid=row-broken]').scrollIntoView({ block: 'center' }); return true;`);
    await browser.screenshot('inline-error-1440.png');
  });

  await step('without the app serving fonts, the drawing is still drawn and nothing is fetched from a CDN', async () => {
    await open('?only=oakfield-garden.excalidraw&fonts=missing');
    await drawn('[data-testid="row-oakfield-garden.excalidraw"]', 1);
    await pause(1000);
    const svg = await ev(`const r = await fetch(document.querySelector('[data-testid="block-oakfield-garden.excalidraw"] img').src); return r.text();`);
    assert.doesNotMatch(svg, /@font-face/);
    const state = await ev(`return { violations: window.__drawings.violations, foreign: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => !name.startsWith(location.origin) && !/^(data|blob):/.test(name)) };`);
    assert.deepEqual(state, { violations: [], foreign: [] });
  });

  await step('with only some fonts served, Excalidraw\'s CDN fallback is refused and the drawing is still drawn', async () => {
    await open('?only=oakfield-garden.excalidraw&fonts=partial');
    await drawn('[data-testid="row-oakfield-garden.excalidraw"]', 1);
    await pause(1000);
    const state = await ev(`return { violations: window.__drawings.violations, foreign: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => !name.startsWith(location.origin) && !/^(data|blob):/.test(name)) };`);
    assert.deepEqual(state, { violations: [], foreign: [] }, 'no CDN request was even attempted');
  });

  await step('on a phone the drawing fits the width', async () => {
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await open('?only=bakery-morning.drawio');
    await drawn('[data-testid="row-bakery-morning.drawio"]', 1);
    const fit = await ev(`const img = document.querySelector('[data-testid="block-bakery-morning.drawio"] img'); return { width: img.getBoundingClientRect().width, page: document.documentElement.scrollWidth };`);
    assert.ok(fit.width <= 390 && fit.page <= 390, JSON.stringify(fit));
    await browser.screenshot('drawio-phone-390.png');
  });
} finally {
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify({ ...report, problems: browser?.problems ?? [] }, null, 2));
  await browser?.close();
  await app.close();
}
