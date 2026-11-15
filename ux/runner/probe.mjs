#!/usr/bin/env node
// Measure one flow (or one step of it) now, in the current worktree, with the harness itself: no model, no pictures, one viewport, about ten seconds.
//   node ux/runner/probe.mjs --step F14@390 --target layout:bar          every step of F14 at 390 that is over a threshold: layout shift, settle time, where focus ends,
//   node ux/runner/probe.mjs --step F14@390#4 --target layout:bar        and the layout-shift SOURCES the browser reports (element, rectangle before and after), largest first
//   options: --all (print every step)   --json   --out <folder> (default .cache/ux-probe)
// With #n only step n is printed (the steps before it still run: they set the state up). Needs CHROMIUM and playwright-core like the rest of the runner (ux/README.md).
// Run `npm run registry:build` first when you changed registry sources, as the loop does. Codex's sandbox cannot start a browser: there the loop runs this for the worker.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './build.mjs';
import { capture } from './capture.mjs';
import { loadAll } from './scenario.mjs';
import { run as findRun, thresholds, traceText } from './trace.mjs';

// One flow at one viewport, measured with the sources recorded: { run, text(opts) }.
export async function probeFlow(scenario, flowId, viewport, outRoot) {
  const { result } = await capture(scenario, outRoot, { fast: true, probe: true, onlyFlows: [flowId], onlyViewport: viewport });
  const flow = findRun(result, flowId, viewport); if (!flow) throw new Error(`flow ${flowId} does not run at ${viewport}`);
  return { run: flow, text: opts => traceText(scenario, flow, opts) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = n => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
  const m = /^(\w+)@(\w+)(?:#(\d+))?$/.exec(opt('step') ?? '');
  if (!m) { console.error('usage: node ux/runner/probe.mjs --step F14@390[#4] --target layout:bar [--all] [--json]'); process.exit(2); }
  const [, flowId, viewport, only] = m, found = loadAll().filter(s => (!opt('target') || s.target === opt('target')) && s.flows.some(f => f.id === flowId));
  if (found.length !== 1) { console.error(found.length ? `${flowId} exists in several targets (${found.map(s => s.target).join(', ')}): pass --target` : `no scenario has a flow ${flowId}`); process.exit(2); }
  const scenario = found[0], { run, text } = await probeFlow(scenario, flowId, viewport, resolve(opt('out') ?? join(root, '.cache/ux-probe')));
  if (args.includes('--json')) console.log(JSON.stringify({ thresholds: thresholds(scenario), flow: run }, null, 1));
  else console.log(text({ only: only ? [Number(only)] : null, all: args.includes('--all') }));
  process.exit(0);
}
