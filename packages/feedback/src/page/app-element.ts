// `app.element@1`: pins on application elements (FEEDBACK.md, "Application elements in Release 1"; FEEDBACK-4, FEEDBACK-8).
// Capture reads the live page only through the WP3 policy: every signal is computed from the masked `app.dom@1` page snapshot,
// the same data `resolve` later sees, so capture and resolution agree by construction. Resolution is pure over that data.
import type { AnchorResolution, Placement, ValueSchema } from '@hachej/boring-ui-kit/contracts';
import { accessibleNameOf } from './privacy/name.js';
import { MASKED_NAME, isExcluded, type PrivacyPolicy } from './privacy/policy.js';
import { serializeElement, serializePage, type AppDomNode, type AppDomSnapshot } from './privacy/serialize.js';

export const APP_ELEMENT_KIND = 'app.element@1';
/** Serialized anchor and element snapshot budgets (FEEDBACK_LIMITS in `./format`). */
const ANCHOR_BYTES = 4096;
const SNAPSHOT_BYTES = 2048;
/** Levels below the picked element kept in its snapshot. `feedback@1` caps front matter nesting at 8 containers (FEEDBACK_LIMITS.depth):
 * front matter, anchors, anchor, snapshot node, its children and a child node with its attrs and children already use 7, so a third
 * level would make the report unparsable. */
const SNAPSHOT_DEPTH = 1;

/** Identity signals, in the order they are tried. */
export type AppElementIdentity = 'feedbackId' | 'testId';

export interface AppElementSignals {
  /** `data-feedback-id`, when the policy kept it. */
  readonly feedbackId?: string;
  /** `data-testid`, when the policy kept it. */
  readonly testId?: string;
  /** Identity signals that occurred exactly once in the complete page snapshot at capture. Only these may place automatically. */
  readonly unique: readonly AppElementIdentity[];
  /** `data-source` (`path:line`), when the policy kept it, and the 0-based occurrence among same-source elements in document order. */
  readonly source?: string;
  readonly sourceIndex?: number;
  /** Explicit kept `role`, otherwise the tag's implicit role. */
  readonly role?: string;
  /** The accessible name, only when the policy allows it (never `masked`). */
  readonly name?: string;
  /** `tag:nth-of-type(n)` chain after a base segment: the nearest `main`, landmark or `feedbackId` ancestor, else the root's tag. */
  readonly path: readonly string[];
}

export interface AppElementAnchor {
  readonly kind: typeof APP_ELEMENT_KIND;
  readonly signals: AppElementSignals;
  /** The masked element snapshot (at most 2 KiB). */
  readonly snapshot: AppDomNode;
  /** `[x, y, width, height]` in CSS pixels at capture; display only, never matched. */
  readonly box?: readonly [number, number, number, number];
  readonly fallback: string;
}

/** A node path in an `app.dom@1` snapshot: child indices from the snapshot root (`[]` is the root). */
export type AppElementRange = readonly number[];

export type AppElementCapture =
  | { readonly kind: 'captured'; readonly anchor: AppElementAnchor }
  | { readonly kind: 'refused'; readonly reason: string };

export interface AnchorOfOptions {
  /** The application root. Elements outside it (portals), in shadow roots or in other documents are refused. */
  readonly root: Element;
  /** A page snapshot of `root` already taken with the same policy; otherwise one is serialized. */
  readonly page?: AppDomSnapshot;
}

// --- shared, pure over app.dom@1 --------------------------------------------

const LANDMARK_TAGS = new Set(['main', 'nav', 'header', 'footer', 'aside']);
const LANDMARK_ROLES = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search', 'region', 'form']);
const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  a: 'link', button: 'button', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
  textarea: 'textbox', select: 'combobox', img: 'img', li: 'listitem', ul: 'list', ol: 'list', nav: 'navigation', main: 'main',
  form: 'form', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', dialog: 'dialog', header: 'banner', footer: 'contentinfo', aside: 'complementary',
};
const INPUT_ROLES: Readonly<Record<string, string>> = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', range: 'slider', search: 'searchbox' };

/** The explicit kept `role`, else the tag's implicit role (the picker labels elements with it). */
export function roleOf(node: AppDomNode): string | undefined {
  const explicit = node.attrs['role'];
  if (explicit) return explicit;
  if (node.tag === 'input') return INPUT_ROLES[(node.attrs['type'] ?? 'text').toLowerCase()] ?? 'textbox';
  return IMPLICIT_ROLES[node.tag];
}

const isMasked = (text: string): boolean => /^\*+$/.test(text);

/** The node's name as far as the snapshot shows it: a kept `aria-label`, else its subtree text. `undefined` when unknown or masked. */
function snapshotName(node: AppDomNode): string | undefined {
  const label = node.attrs['aria-label'];
  if (label) return label;
  const parts: string[] = [];
  let masked = false;
  const walk = (current: AppDomNode): void => {
    for (const piece of current.text.split(' ')) { if (!piece) continue; if (isMasked(piece)) masked = true; else parts.push(piece); }
    for (const child of current.children) if (child.attrs['aria-hidden'] !== 'true') walk(child);
  };
  walk(node);
  return masked || parts.length === 0 ? undefined : parts.join(' ');
}

interface Located { readonly node: AppDomNode; readonly range: AppElementRange; readonly chain: readonly AppDomNode[] }

/** Every node in document order, with its range and its ancestor chain (root first, the node last). */
function locateAll(root: AppDomNode): Located[] {
  const out: Located[] = [];
  const walk = (node: AppDomNode, range: number[], chain: AppDomNode[]): void => {
    const here = [...chain, node];
    out.push({ node, range, chain: here });
    node.children.forEach((child, index) => walk(child, [...range, index], here));
  };
  walk(root, [], []);
  return out;
}

const segment = (node: AppDomNode): string => `${node.tag}:nth-of-type(${node.index + 1})`;

function baseSegment(node: AppDomNode): string | undefined {
  const feedbackId = node.attrs['data-feedback-id'];
  if (feedbackId) return `[data-feedback-id=${JSON.stringify(feedbackId)}]`;
  if (LANDMARK_TAGS.has(node.tag)) return node.tag;
  const role = node.attrs['role'];
  if (role && LANDMARK_ROLES.has(role)) return `[role=${JSON.stringify(role)}]`;
  return undefined;
}

function pathOf(chain: readonly AppDomNode[]): readonly string[] {
  for (let at = chain.length - 2; at >= 0; at--) {
    const base = baseSegment(chain[at] as AppDomNode);
    if (base !== undefined) return [base, ...chain.slice(at + 1).map(segment)];
  }
  const [root, ...rest] = chain;
  return root === undefined ? [] : [root.tag, ...rest.map(segment)];
}

function sourceIndexOf(all: readonly Located[], target: Located): number | undefined {
  const source = target.node.attrs['data-source'];
  if (!source) return undefined;
  let index = 0;
  for (const item of all) { if (item === target) return index; if (item.node.attrs['data-source'] === source) index++; }
  return undefined;
}

const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((item, index) => item === right[index]);

// --- capture (browser) -------------------------------------------------------

function sameTagIndex(element: Element): number {
  let index = 0;
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.localName === element.localName) index++;
  return index;
}

/** The range of a live element in a snapshot of `root`, or `undefined` when it is not in the snapshot (excluded, skipped, or cut by truncation). */
export function rangeOf(element: Element, root: Element, snapshot: AppDomSnapshot): AppElementRange | undefined {
  const chain: Element[] = [];
  let current: Element | null = element;
  for (; current && current !== root; current = current.parentElement) chain.unshift(current);
  if (current !== root || !snapshot.root || snapshot.root.tag !== root.localName) return undefined;
  let node: AppDomNode = snapshot.root;
  const range: number[] = [];
  for (const live of chain) {
    const tag = live.localName, index = sameTagIndex(live);
    const at = node.children.findIndex(child => child.tag === tag && child.index === index);
    const child = node.children[at];
    if (child === undefined) return undefined;
    range.push(at);
    node = child;
  }
  return range;
}

function refusal(element: Element, root: Element): string | undefined {
  if (element.ownerDocument !== root.ownerDocument) return 'the element is in another document (an iframe)';
  if (!element.isConnected) return 'the element is not in the page';
  const host = element.getRootNode();
  if (host !== element.ownerDocument && host !== root.getRootNode()) return 'the element is inside a shadow root';
  if (isExcluded(element)) return 'the element is inside an ignored subtree or the feedback overlay';
  if (!root.contains(element)) return 'the element is outside the application root (a portal)';
  return undefined;
}

function boxOf(element: Element): readonly [number, number, number, number] | undefined {
  try {
    const rect = element.getBoundingClientRect();
    const box = [rect.x, rect.y, rect.width, rect.height].map(Math.round);
    return box.every(Number.isFinite) && (rect.width > 0 || rect.height > 0) ? (box as unknown as readonly [number, number, number, number]) : undefined;
  } catch { return undefined; }
}

const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** Captures an `app.element@1` anchor for a picked element. Every signal passes the policy; refusals say why. */
export function anchorOf(element: Element, policy: PrivacyPolicy, { root, page }: AnchorOfOptions): AppElementCapture {
  const refused = refusal(element, root);
  if (refused !== undefined) return { kind: 'refused', reason: refused };
  const snapshot = page ?? serializePage(root, policy);
  const range = rangeOf(element, root, snapshot);
  if (range === undefined || !snapshot.root) {
    return { kind: 'refused', reason: snapshot.truncated ? 'the page snapshot was truncated before the element' : 'the element is not part of the serialized page' };
  }
  const all = locateAll(snapshot.root);
  const target = all.find(item => sameRange(item.range, range));
  if (target === undefined) return { kind: 'refused', reason: 'the element is not part of the serialized page' };
  const { attrs } = target.node;
  const unique: AppElementIdentity[] = [];
  const feedbackId = attrs['data-feedback-id'], testId = attrs['data-testid'], source = attrs['data-source'];
  if (!snapshot.truncated) {
    if (feedbackId && carriers(all, 'data-feedback-id', feedbackId).length === 1) unique.push('feedbackId');
    if (testId && carriers(all, 'data-testid', testId).length === 1) unique.push('testId');
  }
  const role = roleOf(target.node);
  const name = accessibleNameOf(element, policy);
  const sourceIndex = sourceIndexOf(all, target);
  const signals: AppElementSignals = {
    ...(feedbackId ? { feedbackId } : {}),
    ...(testId ? { testId } : {}),
    unique,
    ...(source ? { source } : {}),
    ...(sourceIndex !== undefined ? { sourceIndex } : {}),
    ...(role ? { role } : {}),
    ...(name !== MASKED_NAME ? { name } : {}),
    path: pathOf(target.chain),
  };
  const box = boxOf(element);
  const base = { kind: APP_ELEMENT_KIND, signals, ...(box ? { box } : {}), fallback: fallbackOf(signals, target.node.tag) } as const;
  // The full element snapshot when it fits the anchor budget, else the element alone.
  for (const options of [{}, { subtreeLimit: 1 }] as const) {
    const own = serializeElement(element, policy, { ...options, maxDepth: SNAPSHOT_DEPTH, maxBytes: SNAPSHOT_BYTES });
    if (!own.root) return { kind: 'refused', reason: 'the element is inside an ignored subtree or the feedback overlay' };
    const anchor: AppElementAnchor = { ...base, snapshot: own.root };
    if (byteLength(own.root) <= SNAPSHOT_BYTES && byteLength(anchor) <= ANCHOR_BYTES) return { kind: 'captured', anchor };
  }
  return { kind: 'refused', reason: `the anchor would exceed ${ANCHOR_BYTES} bytes` };
}

const sameRange = (left: AppElementRange, right: AppElementRange): boolean => left.length === right.length && left.every((item, index) => item === right[index]);
const carriers = (all: readonly Located[], attribute: string, value: string): Located[] => all.filter(item => item.node.attrs[attribute] === value);

// --- fallback ------------------------------------------------------------------

const ROLE_WORDS: Readonly<Record<string, string>> = { textbox: 'text field', img: 'image', listitem: 'list item', columnheader: 'column header', combobox: 'combo box', searchbox: 'search field', contentinfo: 'footer', banner: 'header', complementary: 'aside' };
const QUIET_TAGS = new Set(['div', 'span']);

function contextOf(path: readonly string[]): string {
  const [base, ...rest] = path;
  const words: string[] = [];
  if (base !== undefined && path.length > 1) {
    const id = /^\[data-feedback-id=(".*")\]$/.exec(base)?.[1];
    const role = /^\[role=(".*")\]$/.exec(base)?.[1];
    const value = id ?? role;
    const parsed = value === undefined ? base : String(JSON.parse(value) as unknown);
    words.push(id !== undefined ? `«${parsed}»` : parsed);
  }
  for (const item of rest.slice(0, -1)) {
    const tag = item.replace(/:nth-of-type\(\d+\)$/, '');
    if (!QUIET_TAGS.has(tag)) words.push(tag);
  }
  return words.slice(0, 1).concat(words.slice(1).slice(-3)).join(' › ');
}

/** Human wording from allowed parts only: `the «Save» button (SaveBar.tsx:42)` or `a masked button in main › form`. */
export function fallbackOf(signals: AppElementSignals, tag: string): string {
  const word = signals.role === undefined ? `${tag} element` : (ROLE_WORDS[signals.role] ?? signals.role);
  const file = signals.source?.split('/').pop();
  const where = file ? ` (${file})` : '';
  if (signals.name !== undefined) return `the «${signals.name}» ${word}${where}`;
  const identity = signals.feedbackId ?? signals.testId;
  const context = contextOf(signals.path);
  return `a masked ${word}${identity ? ` «${identity}»` : ''}${context ? ` in ${context}` : ''}${where}`;
}

// --- resolution (pure) ---------------------------------------------------------

/** A candidate that carries a different value for a signal the anchor has contradicts it and is never offered. */
function contradicts(anchor: AppElementSignals, node: AppDomNode, withName: boolean): boolean {
  const differs = (mine: string | undefined, theirs: string | undefined): boolean => mine !== undefined && theirs !== undefined && mine !== theirs;
  if (differs(anchor.feedbackId, node.attrs['data-feedback-id'])) return true;
  if (differs(anchor.testId, node.attrs['data-testid'])) return true;
  if (differs(anchor.source, node.attrs['data-source'])) return true;
  if (differs(anchor.role, roleOf(node))) return true;
  return withName && differs(anchor.name, snapshotName(node));
}

function score(anchor: AppElementSignals, all: readonly Located[], item: Located): number {
  return (sameStrings(pathOf(item.chain), anchor.path) ? 2 : 0) + (anchor.sourceIndex !== undefined && sourceIndexOf(all, item) === anchor.sourceIndex ? 1 : 0);
}

/**
 * Pure placement over one `app.dom@1` snapshot. Automatic only through an identity that was unique at capture and occurs exactly once
 * in a complete (not truncated) snapshot on an element with the same tag: `exact` when its path is unchanged, else `moved`. Otherwise
 * the elements carrying the identity, or, when none does, the elements matching the remaining signals (tag, role, name, source) are
 * `ambiguous` candidates, ranked by path then source occurrence. Nothing compatible is `missing`.
 */
export function resolveAppElement(anchor: AppElementAnchor, snapshot: AppDomSnapshot, evaluated: string): Placement<AppElementRange> {
  if (snapshot.format !== 'app.dom@1' || !snapshot.root) return { kind: 'missing', evaluated };
  const { signals } = anchor;
  const tag = anchor.snapshot.tag;
  const all = locateAll(snapshot.root);
  const sameTag = all.filter(item => item.node.tag === tag);
  const identities: readonly (readonly [AppElementIdentity, string, string | undefined])[] = [
    ['feedbackId', 'data-feedback-id', signals.feedbackId],
    ['testId', 'data-testid', signals.testId],
  ];
  for (const [identity, attribute, value] of identities) {
    if (value === undefined) continue;
    const onPage = carriers(all, attribute, value);
    // Identity holders never contradict a stronger identity the anchor has; feedbackId is tried first.
    const held = onPage.filter(item => item.node.tag === tag && !(identity === 'testId' && contradictsId(signals, item.node)));
    if (held.length === 0) continue;
    const [only] = held;
    if (!snapshot.truncated && onPage.length === 1 && only !== undefined && signals.unique.includes(identity)) {
      return { kind: sameStrings(pathOf(only.chain), signals.path) ? 'exact' : 'moved', range: only.range, evaluated };
    }
    return ambiguous(signals, all, held, evaluated);
  }
  return ambiguous(signals, all, sameTag.filter(item => !contradicts(signals, item.node, true)), evaluated);
}

const contradictsId = (signals: AppElementSignals, node: AppDomNode): boolean => {
  const theirs = node.attrs['data-feedback-id'];
  return signals.feedbackId !== undefined && theirs !== undefined && theirs !== signals.feedbackId;
};

function ambiguous(signals: AppElementSignals, all: readonly Located[], items: readonly Located[], evaluated: string): Placement<AppElementRange> {
  if (items.length === 0) return { kind: 'missing', evaluated };
  const ranked = items.map((item, order) => ({ item, order, score: score(signals, all, item) })).sort((a, b) => b.score - a.score || a.order - b.order);
  return { kind: 'ambiguous', candidates: ranked.map(entry => entry.item.range), evaluated };
}

// --- schema ----------------------------------------------------------------------

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);
function fail(message: string): never { throw new TypeError(`app.element@1: ${message}`); }
const string = (value: unknown, at: string): string => typeof value === 'string' ? value : fail(`${at} must be a string`);
const optionalString = (value: unknown, at: string): string | undefined => value === undefined ? undefined : string(value, at);
const count = (value: unknown, at: string): number => Number.isInteger(value) && (value as number) >= 0 ? value as number : fail(`${at} must be a non-negative integer`);
const only = (value: Readonly<Record<string, unknown>>, keys: readonly string[], at: string): void => {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${at} has unknown field ${JSON.stringify(key)}`);
};

function parseNode(value: unknown, at: string, depth: number): AppDomNode {
  if (depth > 32) fail(`${at} is too deep`);
  if (!isRecord(value)) fail(`${at} must be an object`);
  only(value, ['tag', 'attrs', 'text', 'children', 'index'], at);
  const attrs = value['attrs'];
  if (!isRecord(attrs)) fail(`${at}.attrs must be an object`);
  const children = value['children'];
  if (!Array.isArray(children)) fail(`${at}.children must be an array`);
  return {
    tag: string(value['tag'], `${at}.tag`),
    attrs: Object.fromEntries(Object.entries(attrs).map(([key, item]) => [key, string(item, `${at}.attrs.${key}`)])),
    text: string(value['text'], `${at}.text`),
    children: children.map((child: unknown, index) => parseNode(child, `${at}.children[${index}]`, depth + 1)),
    index: count(value['index'], `${at}.index`),
  };
}

function parseSignals(value: unknown): AppElementSignals {
  if (!isRecord(value)) fail('signals must be an object');
  only(value, ['feedbackId', 'testId', 'unique', 'source', 'sourceIndex', 'role', 'name', 'path'], 'signals');
  const unique = value['unique'], path = value['path'];
  if (!Array.isArray(unique) || !unique.every((item: unknown) => item === 'feedbackId' || item === 'testId')) fail('signals.unique must list feedbackId or testId');
  if (!Array.isArray(path) || !path.every((item: unknown) => typeof item === 'string')) fail('signals.path must be an array of strings');
  const feedbackId = optionalString(value['feedbackId'], 'signals.feedbackId'), testId = optionalString(value['testId'], 'signals.testId');
  const source = optionalString(value['source'], 'signals.source'), role = optionalString(value['role'], 'signals.role'), name = optionalString(value['name'], 'signals.name');
  if (name === MASKED_NAME) fail('signals.name is never the masked marker');
  for (const identity of unique as AppElementIdentity[]) if ((identity === 'feedbackId' ? feedbackId : testId) === undefined) fail(`signals.unique names ${identity}, which is absent`);
  const sourceIndex = value['sourceIndex'] === undefined ? undefined : count(value['sourceIndex'], 'signals.sourceIndex');
  return {
    ...(feedbackId !== undefined ? { feedbackId } : {}),
    ...(testId !== undefined ? { testId } : {}),
    unique: [...(unique as AppElementIdentity[])],
    ...(source !== undefined ? { source } : {}),
    ...(sourceIndex !== undefined ? { sourceIndex } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(name !== undefined ? { name } : {}),
    path: [...(path as string[])],
  };
}

function parseAnchor(value: unknown): AppElementAnchor {
  if (!isRecord(value)) fail('anchor must be an object');
  only(value, ['kind', 'signals', 'snapshot', 'box', 'fallback'], 'anchor');
  if (value['kind'] !== APP_ELEMENT_KIND) fail(`kind must be ${APP_ELEMENT_KIND}`);
  const fallback = string(value['fallback'], 'fallback');
  if (fallback.trim() === '') fail('fallback must not be empty');
  const box = value['box'];
  if (box !== undefined && !(Array.isArray(box) && box.length === 4 && box.every((item: unknown) => typeof item === 'number' && Number.isFinite(item)))) fail('box must be four finite numbers');
  return {
    kind: APP_ELEMENT_KIND,
    signals: parseSignals(value['signals']),
    snapshot: parseNode(value['snapshot'], 'snapshot', 0),
    ...(box !== undefined ? { box: [...(box as number[])] as unknown as readonly [number, number, number, number] } : {}),
    fallback,
  };
}

const NODE_SCHEMA = { type: 'object', required: ['tag', 'attrs', 'text', 'children', 'index'] } as const;

export const appElementSchema: ValueSchema<AppElementAnchor> = {
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'signals', 'snapshot', 'fallback'],
    properties: {
      kind: { const: APP_ELEMENT_KIND },
      signals: {
        type: 'object',
        additionalProperties: false,
        required: ['unique', 'path'],
        properties: {
          feedbackId: { type: 'string' }, testId: { type: 'string' }, source: { type: 'string' }, role: { type: 'string' }, name: { type: 'string' },
          sourceIndex: { type: 'integer', minimum: 0 },
          unique: { type: 'array', items: { enum: ['feedbackId', 'testId'] } },
          path: { type: 'array', items: { type: 'string' } },
        },
      },
      snapshot: NODE_SCHEMA,
      box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
      fallback: { type: 'string', minLength: 1 },
    },
  },
  parse: parseAnchor,
};

/** The pure half of `app.element@1` (`@hachej/boring-ui-kit/contracts` `AnchorResolution`). `evaluated` is `pageDigest(snapshot)`. */
export const appElementResolution: AnchorResolution<AppElementAnchor, AppDomSnapshot, AppElementRange> = {
  kind: APP_ELEMENT_KIND,
  schema: appElementSchema,
  resolve: resolveAppElement,
  fallback: anchor => anchor.fallback,
};

// --- reveal (browser) ------------------------------------------------------------

export type RevealResult =
  | { readonly kind: 'revealed'; readonly element: Element }
  | { readonly kind: 'stale'; readonly reason: string };

const sameAttrs = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => right[key] === left[key]);
};

/**
 * Finds the live element for a range the person may see (an `exact` or `moved` placement, or a candidate they chose) and scrolls it
 * into view. The element must still match the snapshot `resolve` evaluated (tag, kept attributes and own masked text along the way),
 * else `stale`. It draws nothing: the overlay (WP6) highlights the returned element.
 */
export function revealElement(range: AppElementRange, root: Element, snapshot: AppDomSnapshot, policy: PrivacyPolicy): RevealResult {
  let node = snapshot.root;
  if (!node || node.tag !== root.localName) return { kind: 'stale', reason: 'the application root no longer matches the snapshot' };
  let live: Element = root;
  for (const step of range) {
    const child: AppDomNode | undefined = node.children[step];
    if (child === undefined) return { kind: 'stale', reason: 'the range is not in the snapshot' };
    let seen = 0, found: Element | undefined;
    for (const candidate of Array.from(live.children)) {
      if (candidate.localName !== child.tag) continue;
      if (seen++ === child.index) { found = candidate; break; }
    }
    if (found === undefined) return { kind: 'stale', reason: 'the page changed since it was resolved' };
    live = found;
    node = child;
  }
  if (isExcluded(live)) return { kind: 'stale', reason: 'the element is now inside an ignored subtree' };
  const own = serializeElement(live, policy, { subtreeLimit: 1 }).root;
  if (!own || own.tag !== node.tag || !sameAttrs(own.attrs, node.attrs) || own.text !== node.text) {
    return { kind: 'stale', reason: 'the element changed since it was resolved' };
  }
  try { live.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* not scrollable here; still returned for the overlay */ }
  return { kind: 'revealed', element: live };
}
