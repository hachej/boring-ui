import { gpu, Surface } from './gpu.js';
import { materials } from './materials.js';
import { status } from './util.js';

const modules = {
  surfaces: () => import('./surfaces.js'),
  generate: () => import('./generate.js'),
  ambient: () => import('./ambient.js'),
  souffleur: () => import('./souffleur.js'),
  artifacts: () => import('./artifacts.js'),
};
const mounted = new Set();

async function open(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === name));
  history.replaceState(null, '', `#${name}`);
  if (!mounted.has(name)) {
    mounted.add(name);
    const mod = await modules[name]();
    mod.mount(document.getElementById(name));
  }
}

document.getElementById('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('button')?.dataset.tab;
  if (t) open(t);
});

const g = await gpu();
const badge = document.getElementById('gpu-badge');
badge.textContent = g ? 'WebGPU live' : 'no WebGPU: CSS fallback';
badge.classList.add(g ? 'ok' : 'warn');
const orb = new Surface(document.getElementById('brand-orb'), materials.orb, { c1: '#8b5cf6', c2: '#22d3ee' });
orb.set({ energy: 0.3 });

status().then((s) => {
  const m = document.getElementById('model-badge');
  m.textContent = s.live ? `live model: ${s.model}` : 'canned only';
  m.classList.add(s.live ? 'ok' : 'warn');
});

open(location.hash.slice(1) in modules ? location.hash.slice(1) : 'surfaces');
