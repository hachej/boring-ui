// The page side of a preview (FEEDBACK.md, "Preview"): what the browser subagent may do to the live application page, and nothing
// else. Elements are referenced by the feedback pins (`p1`...) or by ids from `inspect` (`e1`...), always inside the application
// root and never inside an ignored subtree. The only writes are inline CSS properties from an allowlist (no `url()`, no unknown
// function, no `!important`) and the text of text-only elements; no attribute other than `style` is written, nothing is inserted,
// submitted, fetched, navigated, stored or evaluated. Every change is logged and `revert` restores the original `style` attribute
// and text nodes, so Discard (or a reload) leaves the page as it was. What the model reads goes through the privacy policy:
// masked `app.dom@1` text, policy-kept attributes, accessible names, a few computed colors and sizes (never a value with `url(`).
import {
  anchorOf, appElementResolution, elementAt, isExcluded, MASKED_NAME, pageDigest, serializeElement, serializePage,
  type AppDomNode, type PrivacyPolicy,
} from '../page/index.js';
import type { PreviewChange } from '../format/index.js';

/** CSS properties a preview may set inline. Layout-breaking or resource-loading ones (`content`, `cursor`, `list-style-image`...) are not here. */
export const PREVIEW_STYLE_PROPERTIES: readonly string[] = Object.freeze([
  'color', 'background', 'background-color', 'opacity', 'visibility',
  'border', 'border-color', 'border-width', 'border-style', 'border-radius',
  ...['top', 'right', 'bottom', 'left'].flatMap(side => [`border-${side}`, `border-${side}-color`, `border-${side}-width`, `border-${side}-style`]),
  'outline', 'outline-color', 'outline-width', 'outline-style', 'outline-offset', 'box-shadow', 'text-shadow',
  'font-size', 'font-weight', 'font-style', 'font-family', 'letter-spacing', 'line-height', 'text-align', 'text-decoration', 'text-transform', 'white-space',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'gap', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'order',
]);

/** CSS functions a value may call; anything else (`url`, `image-set`, `attr`, `var`, `expression`, `paint`...) is refused. */
const FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color-mix', 'calc', 'min', 'max', 'clamp', 'linear-gradient', 'radial-gradient']);
/** Never written to: their text is not page copy, or a change would touch a form value or a document. */
const TEXT_REFUSED = new Set(['input', 'textarea', 'select', 'option', 'optgroup', 'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math']);
const STYLE_REFUSED = new Set(['script', 'style', 'template', 'noscript', 'head', 'meta', 'link', 'base']);
/** Computed properties shown to the model by `inspect`. */
const SHOWN = ['color', 'background-color', 'font-size', 'font-weight', 'display'] as const;
const MAX_CSS = 600, MAX_VALUE = 200, MAX_TEXT = 200, MAX_LISTED = 160;

export type PreviewOutcome = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly reason: string };

export interface PreviewPin {
  /** `p1`, `p2`... in the report's anchor order. */
  readonly id: string;
  readonly fallback: string;
  readonly source?: string;
  /** Why the pin is not on this page now (missing, ambiguous...); the pin cannot be changed then. */
  readonly unplaced?: string;
}

export interface PreviewPage {
  readonly pins: readonly PreviewPin[];
  /** The masked outline of the application root with element ids, pins first. */
  readonly inspect: () => string;
  readonly setStyle: (element: string, css: string) => PreviewOutcome;
  readonly setText: (element: string, text: string) => PreviewOutcome;
  readonly hide: (element: string) => PreviewOutcome;
  readonly show: (element: string) => PreviewOutcome;
  /** Net changes so far (first `from`, last `to`; no-ops dropped), in the order they were first made. */
  readonly changes: () => readonly PreviewChange[];
  /** Restores every touched element's original `style` attribute and text nodes, newest first. Idempotent. */
  readonly revert: () => void;
}

export interface PreviewPageOptions {
  /** The application root. Nothing outside it can be referenced. */
  readonly root: Element;
  readonly policy: PrivacyPolicy;
  /** The feedback report's anchors; `app.element@1` ones placed `exact` or `moved` become pins. */
  readonly anchors?: readonly unknown[];
}

interface Touched {
  readonly element: Element;
  readonly label: { readonly fallback: string; readonly source?: string };
  readonly style: string | null;
  text?: readonly Node[];
}
interface LogEntry { readonly touched: Touched; readonly property?: string; readonly text?: true; readonly from: string; readonly to: string }

/** `prop: value; prop: value`, each checked. Returns the declarations or the reason for refusing. */
export function parseDeclarations(css: string): { readonly ok: true; readonly declarations: readonly (readonly [string, string])[] } | { readonly ok: false; readonly reason: string } {
  if (typeof css !== 'string' || !css.trim()) return { ok: false, reason: 'give CSS declarations such as "background-color: #2f9e44"' };
  if (css.length > MAX_CSS) return { ok: false, reason: `at most ${MAX_CSS} characters of CSS` };
  if (/[{}<>@\\]|\/\*/.test(css)) return { ok: false, reason: 'only plain declarations: no braces, at-rules, comments, escapes or markup' };
  const declarations: (readonly [string, string])[] = [];
  for (const part of css.split(';')) {
    if (!part.trim()) continue;
    const colon = part.indexOf(':');
    if (colon < 0) return { ok: false, reason: `"${part.trim().slice(0, 40)}" is not a declaration` };
    const property = part.slice(0, colon).trim().toLowerCase(), value = part.slice(colon + 1).trim();
    if (!PREVIEW_STYLE_PROPERTIES.includes(property)) return { ok: false, reason: `the property "${property.slice(0, 40)}" cannot be previewed` };
    if (!value || value.length > MAX_VALUE) return { ok: false, reason: `the value of ${property} must be 1 to ${MAX_VALUE} characters` };
    if (value.includes('!')) return { ok: false, reason: '!important is not allowed' };
    if (/["'`]/.test(value) && property !== 'font-family') return { ok: false, reason: 'quotes are allowed in font-family only' };
    for (const match of value.matchAll(/([a-z-]*)\s*\(/gi)) {
      const name = (match[1] ?? '').toLowerCase();
      if (!FUNCTIONS.has(name)) return { ok: false, reason: `the CSS function "${name || '('}" is not allowed (no url(), image-set(), attr(), var() or expressions)` };
    }
    if (/javascript:|expression|behavior|binding/i.test(value)) return { ok: false, reason: 'that value is not allowed' };
    declarations.push([property, value]);
  }
  return declarations.length ? { ok: true, declarations } : { ok: false, reason: 'no declaration was given' };
}

/** A shown value: never one that names a resource. */
const safeValue = (value: string): string => /url\s*\(|image-set|\(\s*["']/i.test(value) ? '(not shown)' : value.slice(0, MAX_VALUE);

/** Builds the preview tools over the live application root. Pins are placed now, against a fresh masked snapshot. */
export async function createPreviewPage(options: PreviewPageOptions): Promise<PreviewPage> {
  const { root, policy } = options;
  const view = root.ownerDocument.defaultView;
  const ids = new Map<string, Element>();
  const idOf = new WeakMap<Element, string>();
  let counter = 0;
  const register = (element: Element): string => {
    const known = idOf.get(element);
    if (known) return known;
    const id = `e${++counter}`;
    ids.set(id, element); idOf.set(element, id);
    return id;
  };

  // Pins: each anchor resolved against the masked page now; only exact and moved placements are usable.
  const pins: PreviewPin[] = [];
  const pinned = new Map<string, Element>();
  const snapshot = serializePage(root, policy);
  const evaluated = await pageDigest(snapshot);
  for (const [index, raw] of (options.anchors ?? []).entries()) {
    const id = `p${index + 1}`;
    let anchor;
    try { anchor = appElementResolution.schema.parse(raw); } catch { pins.push({ id, fallback: 'an element of another kind', unplaced: 'this page places app.element@1 pins only' }); continue; }
    const base = { id, fallback: anchor.fallback, ...(anchor.signals.source ? { source: anchor.signals.source } : {}) };
    const placement = appElementResolution.resolve(anchor, snapshot, evaluated);
    const element = placement.kind === 'exact' || placement.kind === 'moved' ? elementAt(placement.range, root, snapshot) : undefined;
    if (!element) { pins.push({ ...base, unplaced: placement.kind === 'ambiguous' ? 'it matches more than one element now' : 'it is not on this page now' }); continue; }
    pins.push(base);
    pinned.set(id, element);
  }

  const touched = new Map<Element, Touched>();
  const log: LogEntry[] = [];
  const labelOf = (element: Element): Touched['label'] => {
    const captured = anchorOf(element, policy, { root });
    if (captured.kind !== 'captured') return { fallback: 'an element of the page' };
    return { fallback: captured.anchor.fallback, ...(captured.anchor.signals.source ? { source: captured.anchor.signals.source } : {}) };
  };
  const touch = (element: Element): Touched => {
    let record = touched.get(element);
    if (!record) { record = { element, label: labelOf(element), style: element.getAttribute('style') }; touched.set(element, record); }
    return record;
  };

  const resolve = (reference: string): { readonly element: Element } | { readonly reason: string } => {
    if (typeof reference !== 'string') return { reason: 'give an element id such as p1 or e3' };
    const element = pinned.get(reference) ?? ids.get(reference);
    if (!element) return { reason: `no element "${reference.slice(0, 20)}": use a pin (${pins.filter(pin => !pin.unplaced).map(pin => pin.id).join(', ') || 'none placed'}) or an id from inspect` };
    if (!element.isConnected || !root.contains(element)) return { reason: `${reference} is no longer on the page` };
    if (isExcluded(element)) return { reason: `${reference} is not part of the application` };
    return { element };
  };
  const computed = (element: Element, property: string): string => {
    try { return view?.getComputedStyle(element).getPropertyValue(property).trim() ?? ''; } catch { return ''; }
  };
  const styleOf = (element: Element): CSSStyleDeclaration | undefined => (element as HTMLElement).style;

  function setStyle(reference: string, css: string): PreviewOutcome {
    const found = resolve(reference);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const { element } = found;
    if (STYLE_REFUSED.has(element.localName) || !styleOf(element)) return { ok: false, reason: `${reference} cannot be styled` };
    const parsed = parseDeclarations(css);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const record = touch(element);
    const style = styleOf(element)!;
    const applied: string[] = [];
    for (const [property, value] of parsed.declarations) {
      const from = safeValue(style.getPropertyValue(property).trim() || computed(element, property));
      const before = style.getPropertyValue(property);
      style.setProperty(property, value);
      if (!style.getPropertyValue(property)) {
        if (before) style.setProperty(property, before); else style.removeProperty(property);
        return { ok: false, reason: `"${value}" is not a valid ${property}${applied.length ? ` (${applied.join(', ')} applied)` : ''}` };
      }
      log.push({ touched: record, property, from, to: safeValue(value) });
      applied.push(`${property}: ${value}`);
    }
    return { ok: true, message: `${reference}: ${applied.join('; ')}` };
  }

  function setText(reference: string, text: string): PreviewOutcome {
    const found = resolve(reference);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const { element } = found;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || /[<>]/.test(text)) return { ok: false, reason: `the text must be 1 to ${MAX_TEXT} characters, without markup` };
    if (TEXT_REFUSED.has(element.localName) || element.closest('[contenteditable]:not([contenteditable=false])')) return { ok: false, reason: `the text of ${reference} cannot be changed` };
    if (element.children.length) return { ok: false, reason: `${reference} contains other elements: change the text of the innermost element` };
    const own = serializeElement(element, policy, { subtreeLimit: 1 }).root;
    if (!own || own.text === '' || own.text !== (element.textContent ?? '').replace(/\s+/g, ' ').trim()) return { ok: false, reason: `the text of ${reference} is private on this page and cannot be changed in a preview` };
    const record = touch(element);
    if (!record.text) record.text = Array.from(element.childNodes);
    const from = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    element.replaceChildren(element.ownerDocument.createTextNode(text));
    log.push({ touched: record, text: true, from, to: text });
    return { ok: true, message: `${reference}: text is now "${text}"` };
  }

  function hide(reference: string): PreviewOutcome {
    const outcome = setStyle(reference, 'display: none');
    return outcome.ok ? { ok: true, message: `${reference} is hidden` } : outcome;
  }

  function show(reference: string): PreviewOutcome {
    const found = resolve(reference);
    if ('reason' in found) return { ok: false, reason: found.reason };
    const hidden = [...log].reverse().find(entry => entry.touched.element === found.element && entry.property === 'display');
    if (!hidden || hidden.to !== 'none') return { ok: false, reason: `${reference} was not hidden by this preview` };
    const original = /(?:^|;)\s*display\s*:\s*([^;]+)/i.exec(hidden.touched.style ?? '')?.[1]?.trim();
    const style = styleOf(found.element)!;
    if (original) style.setProperty('display', original); else style.removeProperty('display');
    log.push({ touched: hidden.touched, property: 'display', from: 'none', to: original ?? computed(found.element, 'display') });
    return { ok: true, message: `${reference} is shown again` };
  }

  function inspect(): string {
    const page = serializePage(root, policy);
    const lines: string[] = [];
    for (const pin of pins) {
      const element = pinned.get(pin.id);
      lines.push(element ? `${pin.id} = ${register(element)}: ${pin.fallback}` : `${pin.id}: ${pin.fallback} (not usable: ${pin.unplaced})`);
    }
    let listed = 0;
    const visit = (node: AppDomNode, live: Element, depth: number): void => {
      if (listed >= MAX_LISTED) return;
      const role = node.attrs['role'];
      const interesting = node.text || role || node.attrs['data-testid'] || node.attrs['data-feedback-id'] || node.attrs['data-source'] || depth === 0;
      if (interesting) {
        listed++;
        const id = register(live);
        const parts = [`${'  '.repeat(Math.min(depth, 8))}${id} ${node.tag}`];
        if (role) parts.push(`role=${role}`);
        if (node.text) parts.push(JSON.stringify(node.text.slice(0, 80)));
        for (const key of ['data-testid', 'data-feedback-id', 'data-source']) if (node.attrs[key]) parts.push(`${key}=${node.attrs[key]}`);
        const styles = SHOWN.map(property => [property, safeValue(computed(live, property))] as const).filter(([, value]) => value);
        if (styles.length) parts.push(`{${styles.map(([property, value]) => `${property}: ${value}`).join('; ')}}`);
        lines.push(parts.join(' '));
      }
      // The live children in the snapshot's order: same tag, same index among same-tag siblings (as `elementAt` walks).
      for (const child of node.children) {
        let seen = 0, found: Element | undefined;
        for (const candidate of Array.from(live.children)) if (candidate.localName === child.tag && seen++ === child.index) { found = candidate; break; }
        if (found) visit(child, found, depth + 1);
      }
    };
    if (page.root) visit(page.root, root, 0);
    if (page.truncated || listed >= MAX_LISTED) lines.push('(outline truncated)');
    lines.push(`Text shown as ${JSON.stringify(MASKED_NAME)} or with masked characters is private: do not guess it.`);
    return lines.join('\n');
  }

  function changes(): readonly PreviewChange[] {
    const net = new Map<string, { touched: Touched; property?: string; text?: true; from: string; to: string }>();
    const order: string[] = [];
    for (const entry of log) {
      const key = `${[...touched.keys()].indexOf(entry.touched.element)}:${entry.text ? '#text' : entry.property}`;
      const known = net.get(key);
      if (known) known.to = entry.to;
      else { net.set(key, { touched: entry.touched, ...(entry.property ? { property: entry.property } : {}), ...(entry.text ? { text: true as const } : {}), from: entry.from, to: entry.to }); order.push(key); }
    }
    return order.map(key => net.get(key)!).filter(item => item.from !== item.to).map(item => Object.freeze({
      element: item.touched.label.fallback, ...(item.touched.label.source ? { source: item.touched.label.source } : {}),
      ...(item.property ? { property: item.property } : { text: true as const }), from: item.from, to: item.to,
    }));
  }

  function revert(): void {
    for (const record of [...touched.values()].reverse()) {
      if (record.style === null) record.element.removeAttribute('style'); else record.element.setAttribute('style', record.style);
      if (record.text) record.element.replaceChildren(...record.text);
    }
    touched.clear();
    log.length = 0;
  }

  return Object.freeze({ pins: Object.freeze(pins.map(pin => Object.freeze(pin))), inspect, setStyle, setText, hide, show, changes, revert });
}
