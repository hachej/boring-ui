// One target's page, the same anatomy everywhere: name and one line, the live demo in a frame, things to try, usage, start states, then the collapsed status and recordings.
import { findings } from './check.mjs';
import { condition, pick } from './gestures.mjs';
import { esc } from './site-chrome.mjs';
import { stepFacts } from './site-words.mjs';

const viewportName = vp => (vp.touch ? `Phone (${vp.name} px)` : `Desktop (${vp.name} px)`);
const testSelector = t => (/^[\w-]+$/.test(t) ? `[data-testid=${t}]` : t.replace(/^([\w-]+)(\[.*)$/, '[data-testid=$1]$2'));
const firstSentence = text => String(text).split(/(?<=\.)\s/)[0];
const sentence = text => text.charAt(0).toUpperCase() + text.slice(1);

// What `check` measured, in neutral words: how many flow steps complete without a hitch, and what does not pass yet. No grade.
export function summary(scenario, result) {
  const runs = result.flows.map(flow => ({ flow, steps: flow.steps.filter(st => !st.gap).length }));
  const total = runs.reduce((n, r) => n + r.steps, 0), list = scenario ? findings(scenario, result) : [];
  const hit = new Set(list.filter(f => f.flow && f.index !== undefined).map(f => `${f.flow.id}@${f.flow.viewport}#${f.index}`));
  return { total, clean: total - hit.size, list };
}
export const summaryLine = ({ total, clean }) => (clean === total ? `All ${total} flow steps complete without a hitch.` : `${clean} of ${total} flow steps complete without a hitch.`);

// A flow can be played in the embedded demo when every gesture is one the page can perform on a document (no hold, drag, swipe, drop, attach).
const PLAYABLE = new Set(['tap', 'click', 'type', 'press', 'focus', 'scroll', 'wait', 'fixture']);
function compile(scenario, steps, viewport) {
  const mine = steps.filter(st => (!st.only || String(st.only) === viewport) && !(st.skip && String(st.skip) === viewport));
  if (!mine.length || mine.some(st => st.gap || !PLAYABLE.has(st.do))) return undefined;
  return mine.map(st => ({ do: st.do, sel: st.target ? testSelector(pick(st.target, viewport)) : undefined, text: pick(st.text, viewport), choice: pick(st.choice, viewport), key: pick(st.key, viewport),
    ms: st.ms, to: st.to, name: st.name, arg: st.arg, until: st.until ? condition(st.until, viewport) : undefined, timeout: st.timeout, when: st.when ? condition(st.when, viewport) : undefined,
    soft: st.until === 'true' || undefined }));
}

// `scenario.try`: [{ label, flow } | { label, steps }]; without it, the first playable flows, named as the flow is.
function tries(scenario) {
  const items = scenario.try ?? scenario.flows.map(f => ({ label: f.name, flow: f.id }));
  const out = [];
  for (const item of items) {
    const steps = item.steps ?? scenario.flows.find(f => f.id === item.flow)?.steps ?? [];
    const byViewport = Object.fromEntries(scenario.viewports.map(vp => [vp.name, compile(scenario, steps, vp.name)]).filter(([, s]) => s));
    if (Object.keys(byViewport).length) out.push({ label: item.label, steps: byViewport });
    if (out.length === 6) break;
  }
  return out;
}

// Start states: the scenario's states that are a query (and not only the dark theme, which the header switch covers).
function variants(scenario) {
  const seen = new Set(), out = [];
  for (const st of scenario.states) {
    const params = new URLSearchParams(st.query ?? ''); params.delete('dark');
    const query = params.toString();
    if (!query || seen.has(query)) continue;
    seen.add(query);
    out.push({ label: sentence(st.name.replace(/-/g, ' ')), query, only: st.only ? String(st.only) : undefined });
  }
  return out;
}

function demoBlock(scenario, base) {
  const views = scenario.viewports.map(vp => ({ phone: !!vp.touch, name: vp.name, label: vp.touch ? 'Phone' : 'Desktop', w: vp.width, h: vp.height,
    query: ['demo=1', scenario.fixture.query, pick(scenario.fixture.queryBy, vp.name), 'pace=real'].filter(Boolean).join('&') }));
  const list = tries(scenario), start = variants(scenario);
  const data = JSON.stringify({ base, views, tries: list, variants: start }).replace(/</g, '\\u003c');
  return `${list.length ? `<p class="small muted try-label">Things to try <span id="try-status" role="status"></span></p><div class="try">${list.map((t, i) => `<button type="button" data-try="${i}">${esc(t.label)}</button>`).join('')}</div>` : ''}
<div class="toolbar">${views.length > 1 ? `<div class="seg" role="group" aria-label="Screen">${views.map((v, i) => `<button type="button" data-vp="${i}" aria-pressed="false">${v.label}</button>`).join('')}</div>` : ''}
${start.length ? `<div class="chips" role="group" aria-label="Start state"><span class="small muted">Start state</span>${start.map((v, i) => `<button type="button" class="chip" data-variant="${i}" aria-pressed="false">${esc(v.label)}</button>`).join('')}</div>` : ''}</div>
<div class="stage" id="stage"><iframe id="demo" title="Live demo"></iframe></div>
<script type="application/json" id="page-data">${data}</script>`;
}

function usage(fixture) {
  if (!fixture.install && !fixture.usage) return '';
  const code = [fixture.install, fixture.usage].filter(Boolean).join('\n\n');
  return `<h2>Usage</h2><div class="usage"><button type="button" class="copy" data-copy="#usage-code">Copy</button><pre><code id="usage-code">${esc(code)}</code></pre></div>`;
}

function status(scenario, result) {
  const sum = summary(scenario, result), touch = new Set((scenario?.viewports ?? []).filter(v => v.touch).map(v => v.name));
  const where = f => (f.flow ? `${f.flow.id} · ${f.flow.name}, ${touch.has(f.flow.viewport) ? 'phone' : 'desktop'}${f.index === undefined ? '' : `, step ${f.index + 1} « ${f.flow.steps[f.index].say} »`}` : 'The component');
  return `<div class="status"><strong>${esc(summaryLine(sum))}</strong>${sum.list.length ? `<details><summary>What does not pass yet (${sum.list.length})</summary><ul>${sum.list.map(f => `<li><span class="small muted">${esc(where(f))}</span><br>${esc(f.plain)}</li>`).join('')}</ul></details>` : ''}</div>`;
}

function flows(result, scenario) {
  const ids = [...new Set(result.flows.map(f => f.id))];
  if (!ids.length) return '';
  const touch = new Set((scenario?.viewports ?? []).filter(v => v.touch).map(v => v.name));
  const fact = (st, text) => (st.gap && text.startsWith('<span') ? `<span class="gap">Not in the kit yet:</span> ${esc(st.gap)}` : esc(text));
  return `<h2>Flows</h2>${ids.map(id => {
    const runs = result.flows.filter(f => f.id === id).sort((a, b) => Number(touch.has(b.viewport)) - Number(touch.has(a.viewport)));
    const label = run => (touch.has(run.viewport) ? `Phone (${run.viewport} px)` : `Desktop (${run.viewport} px)`);
    return `<details class="flow"><summary>${esc(id)} · ${esc(runs[0].name)} <span class="small muted">· All steps</span></summary>
${runs.map(run => `<h3>${esc(label(run))}</h3><ol class="steps">${run.steps.map(st => `<li><div class="say">${esc(st.say)}</div>${st.expect ? `<div class="expect">${esc(st.expect)}</div>` : ''}<ul class="facts2">${stepFacts(st, touch.has(run.viewport)).map(text => `<li>${fact(st, text)}</li>`).join('')}</ul></li>`).join('')}</ol>`).join('')}
<details><summary>Show recording</summary>${runs.map(run => `<p class="small muted">${esc(label(run))}</p><video controls preload="none" playsinline src="videos/${esc(id)}-${esc(run.viewport)}.webm"></video>`).join('')}</details></details>`;
  }).join('')}`;
}

// `home`: the home page shows the demo of another target (`demoBase` is the folder holding its demo.html) under the kit's name.
export function targetBody({ meta, scenario, result, home, demoBase = '', lead }) {
  const fixture = scenario?.fixture ?? {};
  return `${home ? '' : `<span class="badge">${meta.level === 'layout' ? 'Layout' : 'Component'}</span>`}<h1>${esc(home ?? meta.title)}</h1><p class="lead">${esc(lead ?? scenario?.summary ?? firstSentence(meta.purpose))}</p>
${scenario ? demoBlock(scenario, demoBase) : ''}${home ? '' : `${usage(fixture)}${status(scenario, result)}${flows(result, scenario)}`}`;
}
export { esc };
