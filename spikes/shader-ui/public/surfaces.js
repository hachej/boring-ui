import { Surface, tween } from './gpu.js';
import { materials } from './materials.js';
import { h, api, live, sleep } from './util.js';

const STATES = ['idle', 'thinking', 'streaming', 'error'];
const REPLY = 'Three invoices are overdue, Bluefin Logistics by 31 days. I drafted a gentle reminder for each and flagged Bluefin for a call: their rollout deal is stalled too.';

function panel(cls, material, opts, ...kids) {
  const canvas = h('canvas.mat');
  const el = h(`div.panel.${cls}`, {}, canvas, h('div.panel-body', {}, ...kids));
  const s = new Surface(canvas, material, opts);
  return { el, s, canvas };
}

export function mount(root) {
  root.append(h('div.lede', {},
    h('h1', {}, 'The interface has a body'),
    h('p', {}, 'Each panel below is painted by a GPU shader every frame. The material carries state (what the agent is doing), data (the numbers it shows) and you (the cursor). No images, no video: a few dozen lines of WGSL.')));

  // 1. The agent panel: state lives in the material, not in a spinner.
  const status = h('div.agent-status', {}, 'idle');
  const text = h('p.agent-text', {}, 'Ask me about this week.');
  const agent = panel('agent', materials.aura, { c1: '#5b3df5', c2: '#19c3e6' },
    h('div.agent-head', {}, h('strong', {}, 'Orbit assistant'), status), text);
  let run = 0;
  const setState = async (i) => {
    const my = ++run;
    status.textContent = STATES[i];
    tween(agent.s, 'state', i, 900);
    tween(agent.s, 'energy', i === 0 ? 0.1 : i === 3 ? 0.6 : 0.9, 900);
    root.querySelectorAll('.state-btn').forEach((b, j) => b.classList.toggle('on', j === i));
    if (i === 1) text.textContent = 'Reading invoices and deals…';
    if (i === 3) text.textContent = 'The invoices app did not answer. Retrying in a moment.';
    if (i === 0) text.textContent = 'Ask me about this week.';
    if (i === 2) {
      text.textContent = '';
      for (const word of REPLY.split(' ')) {
        if (my !== run) return;
        text.textContent += `${word} `;
        await sleep(70);
      }
      if (my === run) setState(0);
    }
  };
  const controls = h('div.state-row', {}, STATES.map((s, i) => h('button.state-btn', { onclick: () => setState(i), className: `state-btn${i === 0 ? ' on' : ''}` }, s)));
  agent.s.set({ energy: 0.1 });

  // 2. Data drives the material: overdue days become heat.
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Now'];
  let values = [0.3, 0.45, 0.4, 0.62, 0.8, 0.35, 0.2, 0.9];
  const heat = panel('heat', materials.heat, { c1: '#ff4d00', c2: '#ffd36b' },
    h('div.panel-title', {}, 'Cash at risk, by day'),
    h('div.heat-labels', {}, labels.map((l) => h('span', {}, l))));
  heat.s.set({ data: values });
  const shuffle = () => {
    const next = values.map(() => 0.1 + Math.random() * 0.85);
    const from = [...values];
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 800);
      const e = 1 - Math.pow(1 - k, 3);
      values = from.map((v, i) => v + (next[i] - v) * e);
      heat.s.set({ data: values });
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  heat.el.querySelector('.panel-body').append(h('button.ghost', { onclick: shuffle }, 'New data'));

  // 3. Glass that follows you.
  const glass = panel('glass', materials.glass, { c1: '#0ea5e9', c2: '#a855f7' },
    h('div.panel-title', {}, 'Glass'), h('p.muted', {}, 'Move your cursor here. The light bends towards attention.'));

  // 4. The agent writes a material.
  const lab = shaderLab();

  root.append(h('div.grid-surfaces', {}, h('div.agent-wrap', {}, agent.el, controls), heat.el, glass.el), lab);
}

function shaderLab() {
  const canvas = h('canvas.mat');
  const s = new Surface(canvas, materials.aura, { c1: '#16a34a', c2: '#facc15' });
  s.set({ energy: 0.5 });
  const src = h('textarea.code', { spellcheck: false, value: materials.aura.trim() });
  const err = h('pre.err');
  const ask = h('input.prompt', { placeholder: 'Describe a material: "northern lights over a calm sea", "warning but polite"…' });
  const busy = h('span.muted');
  const compile = async () => {
    const r = await s.setShader(src.value);
    err.textContent = r.ok ? '' : r.error;
    err.classList.toggle('on', !r.ok);
  };
  src.addEventListener('input', () => { clearTimeout(src.t); src.t = setTimeout(compile, 300); });
  const presets = {
    'Northern lights': `fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let t = u.time * 0.15;
  var a = 0.0;
  for (var i = 0; i < 4; i++) {
    let f = f32(i);
    let y = 0.55 + 0.12 * sin(uv.x * (3.0 + f) + t * (1.0 + f * 0.3) + fbm(vec2f(uv.x * 2.0, t + f)) * 2.0);
    a += smoothstep(0.12, 0.0, abs(uv.y - y)) * (0.5 - f * 0.08);
  }
  let sky = mix(vec3f(0.01, 0.02, 0.06), vec3f(0.02, 0.05, 0.12), uv.y);
  let col = sky + a * mix(u.c1.rgb, u.c2.rgb, uv.y);
  return vec4f(col, 1.0);
}`,
    'Polite warning': `fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let stripes = step(0.5, fract((uv.x + uv.y) * 14.0 - u.time * 0.4));
  let pulse = 0.5 + 0.5 * sin(u.time * 2.0);
  let edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let col = mix(vec3f(0.12, 0.08, 0.02), vec3f(0.35, 0.22, 0.02), stripes * (1.0 - edge) * pulse);
  return vec4f(col, 1.0);
}`,
    'Broken (see the error)': `fn shade(uv: vec2f, px: vec2f) -> vec4f {
  let x = uv.x * 2;
  return vec4f(x, 0.0, 0.0, 1.0);
}`,
  };
  const chips = h('div.chips', {}, Object.entries(presets).map(([name, code]) => h('button.chip', { onclick: () => { src.value = code; compile(); } }, name)));
  const go = async () => {
    if (!ask.value.trim()) return;
    if (!live) { busy.textContent = 'No live model: try a preset.'; return; }
    busy.textContent = 'writing a shader…';
    try {
      const r = await api('shader', { prompt: ask.value });
      if (r.c1) s.set({ c1: r.c1, c2: r.c2 });
      src.value = r.wgsl;
      await compile();
      busy.textContent = err.textContent ? 'it wrote a broken one; the old material stays.' : '';
    } catch (e) { busy.textContent = e.message; }
  };
  ask.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  return h('div.lab', {},
    h('div.lab-head', {}, h('h2', {}, 'The agent writes the material'), h('p.muted', {}, 'Describe a feeling; the model writes WGSL; the GPU compiles it in a sandbox. A broken shader shows its error and the previous one keeps running.')),
    h('div.lab-row', {}, ask, h('button.primary', { onclick: go }, 'Write it'), busy),
    chips,
    h('div.lab-grid', {}, h('div.panel.lab-view', {}, canvas), h('div.lab-code', {}, src, err)));
}
