// What the harness measures in the page. Three strings of JavaScript run in the browser; nothing here knows a target.
// INIT (before the page): remembers when a gesture started (the first pointer or key event after `__begin`), when the DOM last changed, and every layout shift.
export const INIT = `(() => { const m = window.__m = { t0: 0, first: null, last: 0 }; window.__shifts = [];
  const start = () => { if (!m.t0) m.t0 = performance.now(); };
  for (const t of ['pointerdown', 'keydown', 'click', 'dragenter', 'drop']) addEventListener(t, start, true);
  addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const n = performance.now(); if (m.t0) { if (m.first === null) m.first = n; m.last = n; } }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }));
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__shifts.push({ v: e.value, t: e.startTime }); }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  window.__begin = prog => { m.t0 = prog ? performance.now() : 0; m.first = null; m.last = 0; window.__mark = window.__shifts.length; };
  if (location.search.includes('kb=1')) { const real = window.visualViewport; const fake = new EventTarget(); let inset = 0;
    for (const key of ['width', 'offsetLeft', 'pageLeft', 'pageTop']) Object.defineProperty(fake, key, { get: () => real[key] });
    Object.defineProperty(fake, 'height', { get: () => window.innerHeight - inset }); Object.defineProperty(fake, 'offsetTop', { get: () => 0 }); Object.defineProperty(fake, 'scale', { get: () => 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    window.__keyboard = px => { inset = px; fake.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('resize')); }; }
})();`;

// SNAP (after a step settled): where the watched boxes are, where focus is, scroll positions, what is outside the screen, overlapping or cut off.
// `watch` is a list of [name, selector] the scenario cares about (the field, the first row of the page, the card...).
export const snap = watch => `((watch) => {
  const box = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const label = e => e.dataset.testid || e.getAttribute('aria-label') || e.tagName.toLowerCase();
  const a = document.activeElement;
  const focus = !a || a === document.body ? 'body' : label(a);
  const shown = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const controls = [...document.querySelectorAll('button, [role=button], input, textarea, a[href]')].filter(shown).map(e => ({ e, b: e.getBoundingClientRect() }));
  const offscreen = controls.filter(({ b }) => b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.left < -1).map(({ e }) => label(e));
  const overlaps = [];
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) { const p = controls[i], q = controls[j]; if (p.e.contains(q.e) || q.e.contains(p.e)) continue;
    const w = Math.min(p.b.right, q.b.right) - Math.max(p.b.left, q.b.left), h = Math.min(p.b.bottom, q.b.bottom) - Math.max(p.b.top, q.b.top);
    if (w > 4 && h > 4) overlaps.push([label(p.e), label(q.e)]); }
  const truncated = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.children.length || !shown(e) || !e.textContent.trim()) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && s.overflowX !== 'visible' && s.textOverflow === 'ellipsis') truncated.push(e.textContent.trim().slice(0, 50));
  }
  for (const input of document.querySelectorAll('input[placeholder], textarea[placeholder]')) if (shown(input) && !input.value) {
    const c = document.createElement('canvas').getContext('2d'); const s = getComputedStyle(input); c.font = s.font;
    if (c.measureText(input.placeholder).width > input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) + 1) truncated.push('placeholder: ' + input.placeholder.slice(0, 40));
  }
  return { focus, watched: Object.fromEntries(watch.map(([name, selector]) => [name, box(selector)])),
    scroll: Object.fromEntries([...document.querySelectorAll('[data-scroll], [data-testid*=scroll], [data-testid=page]')].filter(shown).map(e => [label(e), e.scrollTop])),
    offscreen, overlaps: overlaps.slice(0, 6), truncated: [...new Set(truncated)].slice(0, 6), horizontalScroll: document.documentElement.scrollWidth > innerWidth + 1 };
})(${JSON.stringify(watch)})`;

// TIMING: from the gesture to the first DOM change and to the last one; layout shift summed since the gesture.
export const TIMING = `(() => { const m = window.__m, t0 = m.t0 || 0; const shifts = window.__shifts.slice(window.__mark ?? 0).filter(s => s.t >= t0 - 1);
  return { first: m.first === null || !t0 ? null : Math.round(m.first - t0), settled: m.last && t0 ? Math.round(m.last - t0) : null, cls: Math.round(shifts.reduce((n, s) => n + s.v, 0) * 1000) / 1000 }; })()`;
export const QUIET = `performance.now() - (window.__m.last || 0) > 150 && document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length === 0`;
