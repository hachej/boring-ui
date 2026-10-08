// `app.dom@1`: the masked page snapshot, pure data produced only through the privacy policy (FEEDBACK.md, "Application elements").
// Light DOM only: shadow roots are omitted and iframes are not entered. Form values are never read.
import { allowedAttributes, inVisibleRegion, isAlwaysMasked, isExcluded, maskText, normalizeText, type PrivacyPolicy } from './policy.js';

export interface AppDomNode {
  /** Lower-case local name. */
  readonly tag: string;
  /** Allowed attributes only, keys sorted. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The element's own text nodes, whitespace-normalized and joined by one space; masked unless visible. */
  readonly text: string;
  readonly children: readonly AppDomNode[];
  /** 0-based position among the parent's element children with the same tag (`:nth-of-type` minus one), counted in the live DOM. */
  readonly index: number;
}

export interface AppDomLimits {
  /** Maximum number of nodes. */
  readonly maxNodes: number;
  /** Maximum depth below the root (the root is depth 0). */
  readonly maxDepth: number;
  /** Upper bound on the UTF-8 length of the root's canonical JSON. */
  readonly maxBytes: number;
}

export interface AppDomSnapshot {
  readonly format: 'app.dom@1';
  /** `null` when the root itself is excluded (ignored subtree, overlay, or a non-content element). */
  readonly root: AppDomNode | null;
  /** True when any limit cut the tree: the snapshot is then a prefix (document order) and must never be treated as complete. */
  readonly truncated: boolean;
  readonly nodes: number;
  readonly limits: AppDomLimits;
}

export const PAGE_LIMITS: AppDomLimits = Object.freeze({ maxNodes: 5000, maxDepth: 64, maxBytes: 512 * 1024 });
export const ELEMENT_LIMITS: AppDomLimits = Object.freeze({ maxNodes: 50, maxDepth: 16, maxBytes: 2048 });

/** Never serialized: not page content, or carries no text people see. */
const SKIPPED = new Set(['head', 'title', 'meta', 'link', 'base', 'script', 'style', 'noscript', 'template']);
/** Serialized as a leaf: their content is another document or opaque. */
const LEAVES = new Set(['iframe', 'frame', 'object', 'embed']);

const ELEMENT_NODE = 1, TEXT_NODE = 3, CDATA_NODE = 4;
const encoder = new TextEncoder();
const bytes = (value: string): number => encoder.encode(value).length;

function sameTagIndex(element: Element): number {
  let index = 0;
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.localName === element.localName) index++;
  return index;
}

function ownText(element: Element, policy: PrivacyPolicy): string {
  const parts: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== TEXT_NODE && child.nodeType !== CDATA_NODE) continue;
    const text = normalizeText(child.nodeValue ?? '');
    if (text) parts.push(text);
  }
  const text = parts.join(' ');
  if (!text) return '';
  return !isAlwaysMasked(element) && inVisibleRegion(element, policy) ? text : maskText(text);
}

const skip = (element: Element): boolean => SKIPPED.has(element.localName) || isExcluded(element);

function serialize(start: Element, policy: PrivacyPolicy, limits: AppDomLimits): AppDomSnapshot {
  let nodes = 0, used = 0, truncated = false;
  // Pre-order walk; once a node or byte limit is hit the walk stops, so the result is a deterministic document-order prefix.
  const visit = (element: Element, depth: number): AppDomNode | undefined => {
    const own = { tag: element.localName, attrs: allowedAttributes(element, policy), text: ownText(element, policy), children: [] as AppDomNode[], index: sameTagIndex(element) };
    // Canonical JSON of the node with no children, plus a separating comma: the sum over nodes bounds the whole tree's JSON.
    const cost = bytes(JSON.stringify({ attrs: own.attrs, children: [], index: own.index, tag: own.tag, text: own.text })) + 1;
    if (nodes + 1 > limits.maxNodes || used + cost > limits.maxBytes) { truncated = true; return undefined; }
    nodes++; used += cost;
    if (LEAVES.has(own.tag)) return own;
    for (const child of Array.from(element.children)) {
      if (truncated) break;
      if (child.nodeType !== ELEMENT_NODE || skip(child)) continue;
      if (depth + 1 > limits.maxDepth) { truncated = true; break; }
      const node = visit(child, depth + 1);
      if (node) own.children.push(node);
    }
    return own;
  };
  const root = skip(start) ? null : (visit(start, 0) ?? null);
  return deepFreeze({ format: 'app.dom@1', root, truncated, nodes, limits: Object.freeze({ ...limits }) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function limitsFrom(defaults: AppDomLimits, options: Partial<AppDomLimits>): AppDomLimits {
  const limits = { ...defaults, ...options };
  for (const [name, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return limits;
}

export interface SerializeElementOptions {
  /** Maximum nodes in the element's snapshot, the element included. */
  readonly subtreeLimit?: number;
  readonly maxDepth?: number;
  readonly maxBytes?: number;
}

/** The masked snapshot of one element and its subtree (default: at most 50 nodes, 16 levels, 2 KiB). */
export function serializeElement(element: Element, policy: PrivacyPolicy, { subtreeLimit = ELEMENT_LIMITS.maxNodes, ...rest }: SerializeElementOptions = {}): AppDomSnapshot {
  return serialize(element, policy, limitsFrom(ELEMENT_LIMITS, { maxNodes: subtreeLimit, ...rest }));
}

/** The masked snapshot of a page from its application root (default: at most 5000 nodes, 64 levels, 512 KiB). */
export function serializePage(root: Element, policy: PrivacyPolicy, limits: Partial<AppDomLimits> = {}): AppDomSnapshot {
  return serialize(root, policy, limitsFrom(PAGE_LIMITS, limits));
}
