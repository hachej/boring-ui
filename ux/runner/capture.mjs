// Runs one scenario in a real browser: its static states, then its flows step by step, measuring as it goes.
// Writes <out>/<slug>/{states,flows,videos}/ and result.json. With `fast: true` (check mode) it takes no pictures and no video, and the demo agent answers at once.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPage, root } from './build.mjs';
import { condition, pick, prepare } from './gestures.mjs';
import { INIT, QUIET, TIMING, snap } from './measure.mjs';
import { slug } from './scenario.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export function playwright() {
  for (const from of [process.env.UX_PLAYWRIGHT, join(root, 'package.json')].filter(Boolean)) { try { return createRequire(from.endsWith('.json') ? from : join(from, 'package.json'))('playwright-core'); } catch { /* next */ } }
  throw new Error('playwright-core not found: run `npm i --no-save playwright-core` or set UX_PLAYWRIGHT to a folder that has it');
}
export const launch = () => playwright().chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] });
const queryFor = (s, vp, extra, fast) => ['demo=1', s.fixture.query, pick(s.fixture.queryBy, vp.name), extra, `pace=${fast ? 'instant' : 'real'}`].filter(Boolean).join('&');

// A page, with the probes, errors collected, and the helpers a gesture needs.
export async function open(browser, s, vp, extra, { fast, video }) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.touch ? 2 : 1, isMobile: !!vp.touch, hasTouch: !!vp.touch, locale: 'en-US', ...(video ? { recordVideo: { dir: video, size: { width: vp.width, height: vp.height } } } : {}) });
  const page = await ctx.newPage(); page.setDefaultTimeout(5000);
  const h = { ctx, page, viewport: vp.name, touch: !!vp.touch, errors: new Set(), failed: new Set(), target: null };
  page.on('console', m => { if (m.type() === 'error') h.errors.add(m.text().slice(0, 160)); }); page.on('pageerror', e => h.errors.add(String(e).slice(0, 160)));
  page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') h.failed.add(r.url().slice(0, 120)); }); // a load the page cancelled (a viewer closed mid-load) is not a failure page.on('response', r => { if (r.status() >= 400) h.failed.add(`${r.status()} ${r.url().slice(0, 100)}`); });
  await page.addInitScript(INIT);
  // A page with a viewer bundled inline is several MB: on a busy machine its parse takes longer than the 5 s default.
  await page.goto(`file://${s.page}?${queryFor(s, vp, extra, fast)}`, { timeout: 30000 });
  await page.locator(s.fixture.ready ?? '[data-testid]').first().waitFor({ timeout: 15000 });
  await sleep(500);
  return h;
}

// One step: the gesture, the transition frames, the check that it did what the scenario says, the settle, the measures.
export async function step(h, s, def, ctx) {
  const { page } = h, watch = s.watch;
  const rec = { say: def.say ?? `${def.do} ${pick(def.target ?? def.text ?? def.key ?? '', h.viewport)}`.trim(), expect: def.expect ?? null, gap: def.gap ?? null, ok: false };
  if (def.when && !await page.evaluate(condition(def.when, h.viewport))) return { say: `${rec.say} (skipped: not needed)`, ok: true, skipped: true, gap: null, expect: rec.expect, repeats: 0, target: null, focusAfter: null, offscreen: [], overlaps: [], truncated: [], horizontalScroll: false, cls: 0, moved: {}, scrollBefore: ctx.before.scroll, scrollAfter: ctx.before.scroll };
  const until = condition(def.until, h.viewport), settleMax = def.settleMax ?? 1200;
  h.target = null; h.repeats = 0;
  const before = ctx.before;
  const run = async () => {
    try { const go = await prepare(h, def); await page.evaluate(prog => window.__begin(prog), def.do === 'fixture' || def.do === 'wait'); h.t = Date.now(); await go(); }
    catch (error) { rec.error = String(error.message).split('\n')[0]; h.t ||= Date.now(); }
  };
  h.t = 0;
  const running = run();
  if (def.motion && ctx.shot) for (const at of [80, 200]) {
    while (!h.t) await sleep(5);
    const wait = at - (Date.now() - h.t); if (wait > 0) await sleep(wait);
    const ms = await page.evaluate(() => window.__m.t0 ? Math.round(performance.now() - window.__m.t0) : null);
    await ctx.shot(`${rec.say} (in transition)`, ms ?? 'before the gesture');
  }
  await running;
  const done = () => page.waitForFunction(until, null, { timeout: def.timeout ?? (def.gap ? 600 : 1500) }).then(() => true, () => false);
  rec.ok = await done();
  if (!rec.ok && !def.gap) { h.repeats = 1; delete rec.error; await run(); rec.ok = await done(); }
  const from = Date.now();
  while (Date.now() - from < settleMax) { if (await page.evaluate(QUIET)) break; await sleep(50); }
  const timing = await page.evaluate(TIMING), after = await page.evaluate(snap(watch));
  const moved = (a, b) => a && b ? { dx: Math.abs(a.x - b.x), dy: Math.abs(a.y - b.y), dh: Math.abs(a.h - b.h) } : null;
  Object.assign(rec, { firstChangeMs: timing.first, settledMs: timing.settled, cls: timing.cls, repeats: h.repeats, target: h.target, focusAfter: after.focus, expectFocus: pick(def.focus, h.viewport) ?? null,
    moved: Object.fromEntries(watch.map(([name]) => [name, moved(before.watched[name], after.watched[name])])), scrollBefore: before.scroll, scrollAfter: after.scroll,
    offscreen: after.offscreen, overlaps: after.overlaps, truncated: after.truncated, horizontalScroll: after.horizontalScroll, keepScroll: def.keepScroll ?? null });
  if (ctx.shot) rec.frame = await ctx.shot(`${rec.say}${rec.ok ? '' : def.gap ? ' (NOT IN THE KIT)' : ' (FAILED)'}`, timing.settled, `first change ${timing.first ?? '-'} ms · settled ${timing.settled ?? '-'} ms · layout shift ${timing.cls}`);
  ctx.before = after;
  return rec;
}

async function runStates(browser, s, vp, out, opts, result) {
  for (const st of s.states) {
    if (st.only && String(st.only) !== vp.name) continue;
    const h = await open(browser, s, vp, st.query, opts);
    const ctx = { before: await h.page.evaluate(snap(s.watch)) };
    try { for (const def of st.steps ?? []) await step(h, s, def, ctx); await sleep(500); if (!opts.fast) await h.page.screenshot({ path: join(out, 'states', `${vp.name}-${st.id}-${st.name}.png`) }); result.states.push({ id: st.id, name: st.name, viewport: vp.name, errors: [...h.errors] }); }
    catch (error) { result.stateFailures.push(`${vp.name}-${st.id}-${st.name}: ${String(error.message).split('\n')[0]}`); }
    result.errors.push(...[...h.errors].map(e => `${vp.name} state ${st.id}: ${e}`));
    await h.ctx.close();
  }
}

async function runFlow(browser, s, f, vp, out, opts, result) {
  const dir = join(out, 'flows', f.id, vp.name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const h = await open(browser, s, vp, f.query, opts);
  const frames = [], steps = [];
  const ctx = { before: await h.page.evaluate(snap(s.watch)) };
  if (!opts.fast) ctx.shot = async (label, ms, metric) => { const file = `frame-${String(frames.length).padStart(2, '0')}.png`; await h.page.screenshot({ path: join(dir, file) }); frames.push({ file, label, ms, metric }); return file; };
  await ctx.shot?.('Before', null);
  for (const def of f.steps) { if (def.only && String(def.only) !== vp.name) continue; if (def.skip && String(def.skip) === vp.name) continue; steps.push(await step(h, s, def, ctx)); }
  await h.ctx.close();
  const metrics = { id: f.id, name: f.name, viewport: vp.name, steps, consoleErrors: [...h.errors], failedRequests: [...h.failed] };
  result.flows.push(metrics);
  if (opts.fast) return;
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 1));
  const cell = vp.touch ? 300 : 480, cols = 4;
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0;padding:10px;background:#202124;color:#eee;font:13px system-ui"><h3 style="margin:0 0 8px">${f.id} · ${f.name} · ${vp.name}px</h3><div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:10px">${frames.map((fr, i) => `<figure style="margin:0"><img src="${fr.file}" style="width:${cell}px;display:block;border:1px solid #555"><figcaption style="padding:4px 0;max-width:${cell}px"><b>${i}.</b> ${fr.label.replace(/</g, '&lt;')}${typeof fr.ms === 'number' ? ` · +${fr.ms} ms` : fr.ms ? ` · ${fr.ms}` : ''}${fr.metric ? `<br><span style="color:#9aa">${fr.metric}</span>` : ''}</figcaption></figure>`).join('')}</div>`;
  writeFileSync(join(dir, 'strip.html'), html);
  const sp = await browser.newPage({ viewport: { width: cols * (cell + 10) + 20, height: 600 } });
  await sp.goto(`file://${join(dir, 'strip.html')}`); await sp.screenshot({ path: join(out, 'flows', f.id, `strip-${vp.name}.png`), fullPage: true }); await sp.close();
}

// capture(scenario, outRoot, { fast, only: { flows: [ids], states: [ids] }, browser })
export async function capture(s, outRoot, { fast = false, onlyFlows, onlyStates, browser: given } = {}) {
  const out = join(outRoot, slug(s.target));
  const browser = given ?? await launch();
  s.page = await buildPage(s.fixture.entry, join(outRoot, '_pages', `${slug(s.target)}.html`), { css: s.fixture.css, title: s.title });
  if (!onlyFlows && !onlyStates) rmSync(out, { recursive: true, force: true });
  for (const sub of ['states', 'flows', 'videos']) mkdirSync(join(out, sub), { recursive: true });
  const result = { target: s.target, title: s.title, states: [], stateFailures: [], flows: [], errors: [], fast };
  const opts = { fast };
  await Promise.all(s.viewports.map(async vp => {
    if (!onlyFlows) await runStates(browser, s, vp, out, opts, result);
    for (const f of s.flows) { if (onlyStates || (onlyFlows && !onlyFlows.includes(f.id)) || (f.only && String(f.only) !== vp.name)) continue; await runFlow(browser, s, f, vp, out, opts, result); }
  }));
  result.flows.sort((a, b) => a.id.localeCompare(b.id) || a.viewport.localeCompare(b.viewport));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 1));
  if (!given) await browser.close();
  return { out, result };
}
