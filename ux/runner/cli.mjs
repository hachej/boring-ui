#!/usr/bin/env node
// The UX harness runner. See ux/README.md.
//   node ux/runner/cli.mjs list
//   node ux/runner/cli.mjs capture [--target layout:bar | --level component] [--out <folder>] [--flow F01,F02] [--video]
//   node ux/runner/cli.mjs check   [--target ...] [--level ...] [--flow F01]         no model, no pictures: the regression gate
//   node ux/runner/cli.mjs judge   --target <t> --from <captured folder> [--prev <folder>] [--round N]
//   node ux/runner/cli.mjs site    --from <captured folder> --out <site folder>
// Needs CHROMIUM (a Chromium binary) and playwright-core (see README).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildPage, root } from './build.mjs';
import { capture, launch } from './capture.mjs';
import { check } from './check.mjs';
import { judge } from './judge.mjs';
import { recordFlow } from './video.mjs';
import { level, loadAll, select, slug } from './scenario.mjs';

const args = process.argv.slice(3), cmd = process.argv[2];
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const scenarios = select(loadAll(), { target: opt('target'), level: opt('level') });
const outRoot = resolve(opt('out') ?? join(root, '.cache/ux'));
const git = (...a) => { try { return execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim(); } catch { return ''; } };

async function sheets(folder, s) {
  const states = readdirSync(join(folder, 'states')).sort();
  const browser = await launch();
  for (const vp of s.viewports) {
    const files = states.filter(f => f.startsWith(`${vp.name}-`)), cell = vp.touch ? 230 : 620, cols = vp.touch ? 6 : 3;
    const html = `<!doctype html><meta charset=utf-8><body style="margin:0;padding:12px;background:#222;color:#eee;font:13px system-ui"><div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:12px">${files.map(f => `<figure style="margin:0"><img src="states/${f}" style="width:${cell}px;display:block;border:1px solid #555"><figcaption style="padding:4px 0">${f.replace('.png', '')}</figcaption></figure>`).join('')}</div>`;
    writeFileSync(join(folder, `contact-${vp.name}.html`), html);
    const page = await browser.newPage({ viewport: { width: cols * (cell + 12) + 12, height: 800 } });
    await page.goto(`file://${join(folder, `contact-${vp.name}.html`)}`); await page.screenshot({ path: join(folder, `contact-${vp.name}.png`), fullPage: true }); await page.close();
  }
  await browser.close();
}

if (cmd === 'list') {
  for (const s of scenarios) console.log(`${s.target.padEnd(28)} ${String(s.states.length).padStart(2)} states ${String(s.flows.length).padStart(2)} flows  ${s.title}`);
} else if (cmd === 'capture') {
  const only = opt('flow')?.split(',');
  for (const s of scenarios) {
    const t = Date.now();
    const { out, result } = await capture(s, outRoot, { onlyFlows: only });
    writeFileSync(join(out, 'target.json'), JSON.stringify({ target: s.target, title: s.title, purpose: s.purpose, level: level(s), kitVersion: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, commit: git('rev-parse', '--short', 'HEAD'), capturedAt: new Date().toISOString() }, null, 1));
    if (!only) await sheets(out, s);
    if (args.includes('--video')) { const browser = await launch(); for (const f of s.flows) for (const vp of s.viewports) { if (f.only && String(f.only) !== vp.name) continue; await recordFlow({ scenario: s, flowId: f.id, viewport: vp.name, outDir: join(out, 'videos'), browser }); } await browser.close(); }
    console.log(`${s.target}: ${result.states.length} states, ${result.flows.length} flow runs in ${Math.round((Date.now() - t) / 1000)} s -> ${out}${result.stateFailures.length ? `\n  unreachable states: ${result.stateFailures.join('; ')}` : ''}`);
  }
} else if (cmd === 'check') {
  const browser = await launch();
  let failed = 0;
  for (const s of scenarios) {
    const t = Date.now();
    const { result } = await capture(s, join(outRoot, '_check'), { fast: true, browser, onlyFlows: opt('flow')?.split(',') });
    const problems = check(s, result);
    failed += problems.length;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.target} (${Math.round((Date.now() - t) / 1000)} s)${problems.map(p => `\n   ${p}`).join('')}`);
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
} else if (cmd === 'judge') {
  const s = scenarios[0]; if (!s) throw new Error('--target is required');
  const folder = resolve(opt('from') ?? join(outRoot, slug(s.target)));
  const verdict = judge({ folder, scenario: s, round: Number(opt('round') ?? 0), prev: opt('prev') && resolve(opt('prev')) });
  if (!verdict) { console.error('no usable verdict'); process.exit(1); }
  console.log(JSON.stringify(verdict.grades));
} else if (cmd === 'site') {
  const { site } = await import('./site.mjs');
  await site({ from: resolve(opt('from') ?? outRoot), out: resolve(opt('out') ?? join(outRoot, 'site')), scenarios: loadAll() });
} else if (cmd === 'build') {
  for (const s of scenarios) console.log(await buildPage(s.fixture.entry, join(outRoot, '_pages', `${slug(s.target)}.html`), { css: s.fixture.css, title: s.title }));
} else {
  console.log('usage: cli.mjs list | build | capture | check | judge | site   (see ux/README.md)');
}
