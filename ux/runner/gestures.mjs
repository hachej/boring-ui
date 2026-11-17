// The gesture vocabulary of a scenario step, and the `until` conditions. Fixed on purpose: a scenario stays readable by a designer.
//   tap {target | text | choice}   click with a mouse, tap on a touch viewport     press {key}        a key (Enter, Escape, ArrowUp, Tab...)
//   type {text}                    into the focused field, or into {target}       focus {target}
//   hold {target} / release        press and keep pressing, then let go            scroll {target, to}  to a pixel offset
//   drag {from, to}                mouse drag between two targets                  swipe {target, dir}  up | down | left | right (touch)
//   drop {file, target}            drop a file on a target (drag-enter, then drop) attach {file}        choose a file in the picker
//   wait {ms}                      a pause                                          fixture {name, arg}  one named helper the fixture exposes in window.__ux
//   back                           the browser's Back (a phone's back gesture)     reload               reload the page (what the page keeps across it)
// A target is a test id (`composer-input`) or a CSS selector; where a gesture differs by viewport, give a map: { "390": "...", "1440": "..." }.
// `until` is a list joined with " & ": visible:<t>  gone:<t>  focus:<t>  value:<t>~text  text:<t>~text  count:<t>>=N  eval:<js>; "a|b" inside visible/gone means either.
const css = t => /^[\w-]+$/.test(t) ? `[data-testid=${t}]` : t.replace(/^([\w-]+)(\[.*)$/, '[data-testid=$1]$2');
export const pick = (value, viewport) => value && typeof value === 'object' && !Array.isArray(value) ? value[viewport] ?? value.default : value;
export const FILES = { 'invoice-delmore-0112.pdf': 'application/pdf', 'statement-february.pdf': 'application/pdf', 'discrepancies-january.csv': 'text/csv' };

export function condition(text, viewport) {
  const parts = String(pick(text, viewport) ?? 'true').split(' & ').map(part => {
    const [kind, rest = ''] = [part.slice(0, part.indexOf(':')), part.slice(part.indexOf(':') + 1)];
    const any = list => list.split('|').map(t => `(${shown(css(t))})`).join(' || ');
    if (part === 'true') return 'true';
    if (kind === 'visible') return `(${any(rest)})`;
    if (kind === 'gone') return `!(${any(rest)})`;
    if (kind === 'focus') return `document.activeElement?.matches(${JSON.stringify(css(rest))})`;
    if (kind === 'value' || kind === 'text') { const [t, needle] = rest.split('~'); // An icon-only control (a back arrow) is named by its aria-label, so `text` reads both.
      const read = kind === 'value' ? 'e?.value' : "(e?.textContent ?? '') + ' ' + (e?.getAttribute('aria-label') ?? '')";
      return `((e => ${read})(document.querySelector(${JSON.stringify(css(t))})) ?? '').includes(${JSON.stringify(needle)})`; }
    if (kind === 'count') { const [t, n] = rest.split('>='); return `document.querySelectorAll(${JSON.stringify(css(t))}).length >= ${Number(n)}`; }
    if (kind === 'eval') return `(${rest})`;
    throw new Error(`unknown condition: ${part}`);
  });
  return parts.join(' && ');
}
const shown = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e => e.getClientRects().length > 0)`;

// Prepares one gesture (finds and measures its target) and returns the function that performs it, so the harness times the gesture itself,
// not the waiting for the target to exist. `h` carries the page, the viewport and what the last gesture touched (for target-size metrics).
export async function prepare(h, step) {
  const { page, viewport } = h, touch = h.touch;
  const t = pick(step.target, viewport);
  const loc = () => step.text ? page.getByText(pick(step.text, viewport), { exact: false }).first() : step.choice ? page.locator('[data-choice]', { hasText: pick(step.choice, viewport) }).first() : page.locator(css(t)).first();
  // What a finger reaches: the box, or more when the control's touch area is a pseudo-element (Button size="inline"), found by walking from the centre
  // along each axis while the point still hits the control. Null (the box alone counts) when the centre is covered.
  const reach = l => l.evaluate(el => {
    let r = el.getBoundingClientRect();
    if (r.y < 0 || r.bottom > innerHeight) { el.scrollIntoView({ block: 'nearest' }); r = el.getBoundingClientRect(); }
    const x = r.x + r.width / 2, y = r.y + r.height / 2, mine = (px, py) => { const hit = document.elementFromPoint(px, py); return !!hit && el.contains(hit); };
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight || !mine(x, y)) return null;
    const run = (dx, dy) => { let n = 0; while (n < 60 && mine(x + dx * (n + 1), y + dy * (n + 1))) n++; return n; };
    return { w: run(-1, 0) + run(1, 0) + 1, h: run(0, -1) + run(0, 1) + 1 };
  });
  const ready = async () => {
    const l = loc(); await l.waitFor({ timeout: step.wait ?? 4000 }); const b = await l.boundingBox(); const a = b && touch ? await reach(l) : null;
    // The sheet's grabber counts a tap within 16 px above and below it and 24 px to each side (a window-level detector, `agent-compact`), not a hit-testable box: measure that.
    const grabber = b && await l.evaluate(el => el.matches('[data-slot=drawer-swipe-handle]')).catch(() => false);
    h.target = b ? { w: Math.round(Math.max(b.width + (grabber ? 48 : 0), a?.w ?? 0)), h: Math.round(Math.max(b.height + (grabber ? 32 : 0), a?.h ?? 0)) } : null; return [l, b];
  };
  switch (step.do) {
    case 'tap': case 'click': { const [l] = await ready(); return () => touch ? l.tap() : l.click(); }
    case 'type': { if (t) await page.locator(css(t)).first().focus(); const text = pick(step.text, viewport); return () => page.keyboard.insertText(text); }
    case 'focus': { const l = page.locator(css(t)).first(); await l.waitFor(); return () => l.focus(); }
    case 'press': { const keys = String(pick(step.key, viewport)).split(' '); return async () => { for (const key of keys) await page.keyboard.press(key); }; }
    case 'hold': { const [, b] = await ready(); return async () => { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); }; }
    case 'release': return () => page.mouse.up();
    case 'scroll': { const l = page.locator(css(t)).first(); await l.waitFor(); return async () => { await l.evaluate((e, to) => { e.scrollTop = to; }, step.to ?? 0); await page.waitForTimeout(250); }; }
    case 'drag': { const a = await page.locator(css(pick(step.from, viewport))).first().boundingBox(), b = await page.locator(css(pick(step.to, viewport))).first().boundingBox();
      return async () => { await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up(); }; }
    case 'swipe': { const b = await loc().boundingBox(); const d = { up: [0, -160], down: [0, 160], left: [-160, 0], right: [160, 0] }[step.dir]; const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      return () => page.evaluate(([x, y, dx, dy]) => { const f = (type, X, Y) => (document.elementFromPoint(x, y) ?? document.body).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, clientX: X, clientY: Y })); f('pointerdown', x, y); for (let i = 1; i <= 8; i++) f('pointermove', x + dx * i / 8, y + dy * i / 8); f('pointerup', x + dx, y + dy); }, [cx, cy, ...d]); }
    case 'drop': { const name = step.file, sel = css(t); return () => page.evaluate(([sel, name, type, phase]) => { const el = document.querySelector(sel); const data = window.__dt ??= (() => { const d = new DataTransfer(); d.items.add(new File(['x'], name, { type })); return d; })();
      for (const kind of phase === 'enter' ? ['dragenter', 'dragover'] : ['drop']) el.dispatchEvent(new DragEvent(kind, { dataTransfer: data, bubbles: true, cancelable: true })); }, [sel, name, FILES[name] ?? 'application/octet-stream', step.phase === 'enter' ? 'enter' : 'drop']); }
    case 'attach': { const name = step.file; let l; if (t) [l] = await ready(); return async () => { if (l) await (touch ? l.tap() : l.click()); await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: FILES[name] ?? 'application/octet-stream', buffer: Buffer.from('%PDF fictional') }); }; }
    case 'keyboard': return () => page.evaluate(px => window.__keyboard?.(px), step.px ?? 0);
    case 'wait': return () => page.waitForTimeout(step.ms ?? 300);
    case 'back': return () => page.evaluate(() => history.back());
    case 'reload': return () => page.reload({ waitUntil: 'load' });
    case 'fixture': return () => page.evaluate(([name, arg]) => window.__ux[name](arg), [step.name, step.arg]);
    default: throw new Error(`unknown gesture: ${step.do}`);
  }
}
