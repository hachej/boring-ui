// Accessible names from allowed sources only. A name is either fully readable or `masked`: one masked piece masks the whole name.
import { MASKED_NAME, inVisibleRegion, isAlwaysMasked, isExcluded, keptValue, normalizeText, type PrivacyPolicy } from './policy.js';

const MAX_NAME = 120;
const ELEMENT_NODE = 1, TEXT_NODE = 3, CDATA_NODE = 4;
const SKIPPED = new Set(['head', 'title', 'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);
/** Elements whose name comes only from a label, never from their own content or value. */
const LABEL_ONLY = new Set(['input', 'select', 'textarea', 'output', 'img', 'meter', 'progress']);

const VALUELESS_INPUTS = new Set(['checkbox', 'radio', 'hidden', 'file', 'image']);
/** Whether an embedded form control would put its value or content into the enclosing name. */
function contributesValue(control: Element): boolean {
  if (control.localName === 'input') return !VALUELESS_INPUTS.has((control.getAttribute('type') ?? 'text').toLowerCase());
  return control.localName === 'select' || control.localName === 'textarea' || normalizeText(control.textContent ?? '') !== '';
}

/** Visible text of a subtree, or `undefined` when any piece of it would be masked. Hidden and excluded subtrees contribute nothing. */
function readableText(element: Element, policy: PrivacyPolicy): string | undefined {
  if (SKIPPED.has(element.localName) || isExcluded(element) || element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return '';
  const parts: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) {
      const text = normalizeText(child.nodeValue ?? '');
      if (!text) continue;
      if (isAlwaysMasked(element) || !inVisibleRegion(element, policy)) return undefined;
      parts.push(text);
    } else if (child.nodeType === ELEMENT_NODE) {
      const inner = child as Element;
      // A form control inside a label or button contributes its value in the accessibility tree; values are never read.
      if (isAlwaysMasked(inner)) { if (contributesValue(inner)) return undefined; continue; }
      const text = readableText(inner, policy);
      if (text === undefined) return undefined;
      if (text) parts.push(text);
    }
  }
  return normalizeText(parts.join(' '));
}

function labelsOf(element: Element): readonly Element[] {
  const labels = (element as { readonly labels?: ArrayLike<Element> | null }).labels;
  if (labels) return Array.from(labels);
  const found: Element[] = [];
  const wrapping = element.parentElement?.closest('label');
  if (wrapping) found.push(wrapping);
  const id = element.getAttribute('id');
  if (id) for (const label of Array.from(element.ownerDocument.querySelectorAll('label[for]'))) if (label.getAttribute('for') === id && !found.includes(label)) found.push(label);
  return found;
}

function joined(sources: readonly Element[], policy: PrivacyPolicy): string | undefined {
  const parts: string[] = [];
  for (const source of sources) {
    const text = readableText(source, policy);
    if (text === undefined) return undefined;
    if (text) parts.push(text);
  }
  return normalizeText(parts.join(' '));
}

function bounded(name: string | undefined): string {
  if (!name) return MASKED_NAME;
  const points = Array.from(name);
  return points.length > MAX_NAME ? `${points.slice(0, MAX_NAME - 1).join('')}…` : name;
}

/**
 * The element's accessible name, from allowed sources only: `aria-labelledby` and `<label>` targets and the element's own text when
 * that text is visible, and `aria-label` only inside a visible region. Values, placeholders, `title`, `alt` and masked text are never
 * used; the result is then `masked`.
 */
export function accessibleNameOf(element: Element, policy: PrivacyPolicy): string {
  if (isExcluded(element)) return MASKED_NAME;
  const labelledBy = normalizeText(element.getAttribute('aria-labelledby') ?? '');
  if (labelledBy) {
    const sources = labelledBy.split(' ').map(id => element.ownerDocument.getElementById(id));
    if (sources.some(source => source === null || isExcluded(source))) return MASKED_NAME;
    return bounded(joined(sources as Element[], policy));
  }
  const label = element.getAttribute('aria-label');
  if (label !== null && normalizeText(label)) return inVisibleRegion(element, policy) && keptValue(label) ? bounded(normalizeText(label)) : MASKED_NAME;
  const tag = element.localName;
  if (LABELABLE.has(tag) && !(tag === 'input' && element.getAttribute('type')?.toLowerCase() === 'hidden')) {
    const labels = labelsOf(element);
    if (labels.length) return bounded(joined(labels, policy));
  }
  if (LABEL_ONLY.has(tag) || isAlwaysMasked(element)) return MASKED_NAME;
  return bounded(readableText(element, policy));
}
