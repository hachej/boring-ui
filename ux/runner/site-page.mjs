// One target's page: the live demo, the static states, each flow with its sentences and plain-word measurements, the status line.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findings } from './check.mjs';
import { pick } from './gestures.mjs';
import { stepFacts } from './site-words.mjs';

export const esc = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const head = (title, depth, description) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ''}<link rel="icon" href="data:,"><link rel="stylesheet" href="${depth ? '../' : ''}site.css"></head><body>`;
export const nav = depth => `<nav class="top"><a href="${depth ? '../' : ''}index.html">Boring UI showcase</a><span class="muted small">Facts measured in a real browser, nothing judged by a model</span></nav>`;
const viewportName = vp => (vp.touch ? `Phone (${vp.name} px)` : `Desktop (${vp.name} px)`);

// What `check` measured, in neutral words: how many flow steps complete without a hitch, and what does not pass yet. No grade, no colour of alarm.
export function summary(scenario, result) {
  const runs = result.flows.map(flow => ({ flow, steps: flow.steps.filter(st => !st.gap).length }));
  const total = runs.reduce((n, r) => n + r.steps, 0), list = scenario ? findings(scenario, result) : [];
  const hit = new Set(list.filter(f => f.flow && f.index !== undefined).map(f => `${f.flow.id}@${f.flow.viewport}#${f.index}`));
  return { total, clean: total - hit.size, list };
}

export const summaryLine = ({ total, clean }) => (clean === total ? `All ${total} flow steps complete without a hitch.` : `${clean} of ${total} flow steps complete without a hitch.`);

function statusLine(scenario, result, touch) {
  const sum = summary(scenario, result);
  if (!sum.list.length) return `<div class="status"><strong>${esc(summaryLine(sum))}</strong> Measured in a real browser at every screen size listed below.</div>`;
  const where = f => (f.flow ? `${f.flow.id} · ${f.flow.name}, ${touch.has(f.flow.viewport) ? 'phone' : 'desktop'}${f.index === undefined ? '' : `, step ${f.index + 1} « ${f.flow.steps[f.index].say} »`}` : 'The component');
  return `<div class="status"><strong>${esc(summaryLine(sum))}</strong> Measured in a real browser; this is a measurement, not a grade.
<details><summary>What does not pass yet (${sum.list.length})</summary><ul>${sum.list.map(f => `<li><span class="small muted">${esc(where(f))}</span><br>${esc(f.plain)}</li>`).join('')}</ul></details></div>`;
}

function demoBlock(scenario) {
  const vps = scenario.viewports.map(vp => ({ phone: !!vp.touch, label: vp.touch ? 'Phone' : 'Desktop', w: vp.width, h: vp.height,
    query: ['demo=1', scenario.fixture.query, pick(scenario.fixture.queryBy, vp.name), 'pace=real'].filter(Boolean).join('&') }));
  return `<h2>Try it</h2><p class="muted small">The real component with an invented, scripted assistant: type, tap, open things. Nothing leaves your browser.</p>
<div class="toggles"><div class="seg" role="group" aria-label="Screen">${vps.map((v, i) => `<button type="button" data-vp="${i}" aria-pressed="false">${v.label}</button>`).join('')}</div>
<div class="seg" role="group" aria-label="Theme"><button type="button" data-dark="0" aria-pressed="true">Light</button><button type="button" data-dark="1" aria-pressed="false">Dark</button></div></div>
<div class="stage" id="stage"><div class="box" id="box"><iframe id="demo" title="Live demo" loading="lazy"></iframe></div></div>
<script>(()=>{const V=${JSON.stringify(vps).replace(/</g, '\\u003c')};let vp=0,dark=0;const f=document.getElementById('demo'),box=document.getElementById('box'),stage=document.getElementById('stage');
const fit=()=>{const v=V[vp],s=Math.min(1,(stage.clientWidth-2)/v.w);f.style.width=v.w+'px';f.style.height=v.h+'px';f.style.transform='scale('+s+')';box.style.width=v.w*s+'px';box.style.height=v.h*s+'px'};
const show=()=>{f.src='demo.html?'+V[vp].query+(dark?'&dark=1':'');for(const b of document.querySelectorAll('[data-vp]'))b.setAttribute('aria-pressed',String(+b.dataset.vp===vp));for(const b of document.querySelectorAll('[data-dark]'))b.setAttribute('aria-pressed',String(+b.dataset.dark===dark));fit()};
for(const b of document.querySelectorAll('[data-vp]'))b.onclick=()=>{vp=+b.dataset.vp;show()};for(const b of document.querySelectorAll('[data-dark]'))b.onclick=()=>{dark=+b.dataset.dark;show()};
const phone=V.findIndex(v=>v.phone),desk=V.findIndex(v=>!v.phone);vp=innerWidth<760&&phone>=0?phone:desk>=0?desk:0;addEventListener('resize',fit);show()})()</script>`;
}

function states(folder, scenario) {
  let files = [];
  try { files = readdirSync(join(folder, 'states')).filter(f => f.endsWith('.png')).sort(); } catch { /* none */ }
  if (!files.length) return '';
  const by = new Map((scenario?.viewports ?? []).map(vp => [vp.name, vp]));
  const names = [...new Set(files.map(f => f.split('-')[0]))].sort((a, b) => Number(!!by.get(b)?.touch) - Number(!!by.get(a)?.touch));
  const label = f => f.replace(/^[^-]+-/, '').replace(/\.png$/, '').replace(/^(\d+)-/, '$1 · ').replace(/-/g, ' ');
  return `<h2>States</h2><p class="muted small">Still pictures of the component in each state a person can reach.</p>${names.map(vp => `<h3>${esc(by.get(vp) ? viewportName(by.get(vp)) : `${vp} px`)}</h3><div class="shots${by.get(vp)?.touch ? '' : ' wide'}">${files.filter(f => f.startsWith(`${vp}-`)).map(f => `<figure><a href="states/${esc(f)}"><img loading="lazy" src="states/${esc(f)}" alt="${esc(label(f))}"></a><figcaption>${esc(label(f))}</figcaption></figure>`).join('')}</div>`).join('')}`;
}

function flows(result, scenario) {
  const ids = [...new Set(result.flows.map(f => f.id))];
  if (!ids.length) return '';
  const touch = new Set((scenario?.viewports ?? []).filter(v => v.touch).map(v => v.name));
  const fact = (st, text) => (st.gap && text.startsWith('<span') ? `<span class="gap">Not in the kit yet:</span> ${esc(st.gap)}` : esc(text));
  return `<h2>Flows</h2><p class="muted small">Each flow is a short task a person does. The sentences are what the harness did and what must be true; the numbers are measured.</p>${ids.map(id => {
    const runs = result.flows.filter(f => f.id === id).sort((a, b) => Number(touch.has(b.viewport)) - Number(touch.has(a.viewport)));
    return `<h3>${esc(id)} · ${esc(runs[0].name)}</h3>${runs.map(run => `<details${run === runs[0] ? ' open' : ''}><summary>${esc(touch.has(run.viewport) ? `Phone (${run.viewport} px)` : `Desktop (${run.viewport} px)`)}</summary>
<div class="strip"><a href="flows/${esc(id)}/strip-${esc(run.viewport)}.png"><img loading="lazy" src="flows/${esc(id)}/strip-${esc(run.viewport)}.png" alt="Frames of the flow, left to right"></a></div>
<ol class="steps">${run.steps.map(st => `<li>${st.frame ? `<a class="frame" href="flows/${esc(id)}/${esc(run.viewport)}/${esc(st.frame)}"><img loading="lazy" src="flows/${esc(id)}/${esc(run.viewport)}/${esc(st.frame)}" alt="The screen after this step"></a>` : ''}<div class="say">${esc(st.say)}</div>${st.expect ? `<div class="expect">${esc(st.expect)}</div>` : ''}<ul class="facts2">${stepFacts(st, touch.has(run.viewport)).map(text => `<li>${fact(st, text)}</li>`).join('')}</ul></li>`).join('')}</ol>
<video controls preload="none" playsinline src="videos/${esc(id)}-${esc(run.viewport)}.webm"></video></details>`).join('')}`;
  }).join('')}`;
}

export function targetPage({ meta, scenario, result, folder }) {
  const fixture = scenario?.fixture ?? {};
  return `${head(`${meta.title} · Boring UI showcase`, 1, meta.purpose)}${nav(1)}<main>
<span class="badge">${esc(meta.level === 'layout' ? 'Layout' : 'Component')}</span><h1>${esc(meta.title)}</h1><p class="lead">${esc(meta.purpose)}</p>
<div class="facts"><span>Kit ${esc(meta.kitVersion)}</span><span>Commit ${esc(meta.commit)}</span><span>Captured ${esc(String(meta.capturedAt).slice(0, 10))}</span></div>
${statusLine(scenario, result, new Set((scenario?.viewports ?? []).filter(v => v.touch).map(v => v.name)))}
${scenario ? demoBlock(scenario) : ''}
${fixture.install || fixture.usage ? `<h2>Use it</h2>${fixture.install ? `<pre><code>${esc(fixture.install)}</code></pre>` : ''}${fixture.usage ? `<pre><code>${esc(fixture.usage)}</code></pre>` : ''}` : ''}
${states(folder, scenario)}${flows(result, scenario)}
<footer>Generated from a captured run of ${esc(meta.target)}. Scenario data and demo content are invented.</footer></main></body></html>`;
}
