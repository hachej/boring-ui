// The trusted renderer for generated screens: a spec (JSON) in, DOM + shader materials out.
// Generated content is only ever data here; the one piece of generated code is the WGSL
// material, which runs on the GPU and can only paint pixels.
import { Surface } from './gpu.js';
import { materials } from './materials.js';
import { h } from './util.js';

let live = new Set();

function glowLayer(glow, palette) {
  if (!glow) return null;
  const c = h('canvas.glow');
  const s = new Surface(c, materials.aura, { c1: palette.c1, c2: palette.c2 });
  s.set({ state: 2, energy: glow });
  live.add(s);
  c.style.opacity = String(0.35 + glow * 0.65);
  return c;
}

const blocks = {
  stat: (b, pal) => h('div.blk.stat', {}, glowLayer(b.glow, pal),
    h('div.stat-label', {}, b.label), h('div.stat-value', {}, b.value), b.hint && h('div.stat-hint', {}, b.hint)),
  text: (b) => h('div.blk.text', {}, h('p', {}, b.body)),
  board: (b, pal) => h('div.blk.board', {}, (b.columns ?? []).map((col) =>
    h('div.col', {}, h('div.col-title', {}, col.title, h('span', {}, (col.cards ?? []).length)),
      (col.cards ?? []).map((card) => h('div.card', {}, glowLayer(card.glow, pal), h('div.card-title', {}, card.title), card.meta && h('div.card-meta', {}, card.meta)))))),
  table: (b, pal) => h('div.blk.table', {}, h('table', {},
    h('thead', {}, h('tr', {}, (b.columns ?? []).map((c) => h('th', {}, c)))),
    h('tbody', {}, (b.rows ?? []).map((r, i) => h('tr', { className: (b.glowRows ?? []).includes(i) ? 'hot' : '' }, r.map((c) => h('td', {}, c))))))),
  chart: (b, pal) => {
    const vals = (b.values ?? []).slice(0, 8).map(Number);
    const max = Math.max(...vals, 1);
    const c = h('canvas.mat');
    const s = new Surface(c, materials.heat, { c1: pal.c1, c2: pal.c2 });
    const data = Array.from({ length: 8 }, (_, i) => (i < vals.length ? vals[i] / max : 0));
    s.set({ data });
    live.add(s);
    return h('div.blk.chart', {}, c, h('div.chart-label', {}, b.label),
      h('div.chart-x', {}, data.map((_, i) => h('span', {}, b.labels?.[i] ?? ''))));
  },
};

// Renders into `root`; returns { background, error } where error is a shader compile error.
export async function render(root, spec) {
  // Surfaces belong to the root they were drawn in, so two screens never tear each other down.
  for (const s of root.surfaces ?? []) s.destroy();
  live = root.surfaces = new Set();
  root.replaceChildren();
  const pal = { c1: spec.palette?.c1 ?? '#6d5dfc', c2: spec.palette?.c2 ?? '#22d3ee' };
  const bg = h('canvas.mat.bg');
  const surface = new Surface(bg, materials.aura, pal);
  surface.set({ energy: 0.4 });
  live.add(surface);
  const grid = h('div.screen-grid', {}, (spec.blocks ?? []).map((b) => {
    const el = (blocks[b.type] ?? blocks.text)(b, pal);
    el.style.gridColumn = `span ${Math.min(3, b.span ?? (b.type === 'board' || b.type === 'table' ? 3 : 1))}`;
    return el;
  }));
  root.append(bg, h('div.screen-body', {}, h('h2', {}, spec.title ?? 'Untitled'), spec.subtitle && h('p.muted', {}, spec.subtitle), grid));
  await surface.ready;
  const want = spec.background ?? {};
  let error = null;
  if (want.wgsl) {
    const r = await surface.setShader(want.wgsl);
    if (!r.ok) error = r.error;
  } else if (materials[want.material]) {
    await surface.setShader(materials[want.material]);
  }
  return { surface, error, wgsl: want.wgsl ?? materials[want.material] ?? materials.aura };
}
