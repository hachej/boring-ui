// Surface equality for viewers and editors (D-1734): a surface that carries content (a viewer frame, an editor, a pane) must not paint
// the same token as the surface under it, or the page reads as one grey sheet with a hairline; and a flat surface draws no edge of its own.
// Class based, so it runs in happy-dom (no layout, no computed Tailwind). Written to be shared: it takes elements and returns strings and booleans,
// never asserts on elements (a failing assert.equal on a happy-dom element looks like a runner shutdown).
const BASE_SURFACE = 'bg-background';

/** The unprefixed background token an element paints itself (`bg-card`), 'transparent' for none or bg-transparent. Variants (dark:, hover:) are not the base paint. */
export function ownSurface(element) {
  const tokens = String(element.getAttribute('class') ?? '').split(/\s+/).filter(token => /^bg-[a-z]/.test(token) && !/^bg-(?:none|clip|fixed|local|scroll|origin|repeat|cover|contain|center|top|bottom|left|right|no-repeat)/.test(token));
  const token = tokens.at(-1);
  return token === undefined || token === 'bg-transparent' ? 'transparent' : token.replace(/\/\d+$/, '');
}

/** The paint a person sees: the nearest self-painted ancestor (or the element), else the page's base surface. */
export function effectiveSurface(element) {
  for (let node = element; node; node = node.parentElement) { const own = ownSurface(node); if (own !== 'transparent') return own; }
  return BASE_SURFACE;
}

/** The surface a content element must differ from: what is painted under it. */
export function surfaceUnder(element) {
  return element.parentElement ? effectiveSurface(element.parentElement) : BASE_SURFACE;
}

/** True when the element paints its own surface and it is not the one under it. */
export function isDistinctSurface(element) {
  const own = ownSurface(element);
  return own !== 'transparent' && own !== surfaceUnder(element);
}

/** Edge classes an element draws on its own: border widths, rings and shadows at rest (focus-visible/hover variants are states, not edges). */
export function restingEdges(element) {
  return String(element.getAttribute('class') ?? '').split(/\s+/).filter(token => /^(?:border(?:-[trblxyse])?(?:-\d+)?|ring(?:-\d+)?|shadow(?:-[a-z0-9]+)?|outline(?:-\d+)?)$/.test(token) && !/^(?:border|outline)-0$|^(?:border-[trblxyse])-0$|^shadow-none$|^ring-0$/.test(token));
}
