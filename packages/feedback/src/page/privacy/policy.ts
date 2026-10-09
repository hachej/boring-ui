// The privacy policy for page content (FEEDBACK.md, "Privacy policy for page content"; FEEDBACK-8).
// Allowlist-based: anything not allowed is dropped or masked. Every option that loosens the default is recorded in `widened`.

/** Marks a region whose text (and `aria-label`/`aria-description`) may leave the page. Presence counts, whatever its value. */
export const FEEDBACK_VISIBLE_ATTRIBUTE = 'data-feedback-visible';
/** Marks a subtree that is never serialized, named or picked (the application's own chrome, the agent bar). */
export const FEEDBACK_IGNORE_ATTRIBUTE = 'data-feedback-ignore';
/** Marks the picker overlay's host element; it and its subtree are excluded from every snapshot. */
export const FEEDBACK_OVERLAY_ATTRIBUTE = 'data-feedback-overlay';
/** The name returned whenever the accessible name would come from masked or disallowed sources. */
export const MASKED_NAME = 'masked';

/** Attributes kept by default. Values still pass `keptValue`. */
export const DEFAULT_KEPT_ATTRIBUTES: readonly string[] = Object.freeze([
  'role', 'type', 'data-testid', 'data-feedback-id', 'data-source',
  'aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-disabled', 'aria-hidden', 'aria-current',
]);

/** Kept only inside a visible region. */
export const VISIBLE_REGION_ATTRIBUTES: readonly string[] = Object.freeze(['aria-label', 'aria-description']);

/** Channels that are always masked, so no option can widen them: values, placeholders, event handlers and inline documents. */
const NEVER_ALLOWED = /^(?:on.*|value|placeholder|srcdoc)$/;
const ATTRIBUTE_NAME = /^[a-z_:][a-z0-9_.:-]*$/;

/** What `routeOf` receives: the parts of a `Location` the route is derived from. */
export interface RouteLocation {
  readonly pathname: string;
  readonly search?: string;
  readonly hash?: string;
}

export interface PrivacyPolicyOptions {
  /** Extra attribute names to keep (lower case). Their values still pass the digit/`@` rule. */
  readonly allowAttributes?: readonly string[];
  /** A CSS selector whose matches (and their descendants) count as visible regions, besides `data-feedback-visible`. */
  readonly visibleSelector?: string;
  /** The application's route template for a location (`/orders/:id`). Its query and fragment are cut. */
  readonly routeOf?: (location: RouteLocation) => string;
  /** A document label supplied by the application; the document title is never read. */
  readonly label?: string;
}

export interface PrivacyPolicy {
  readonly version: 1;
  /** Every loosening of the default, in a stable order: `allowAttributes:<name>`, `visibleSelector:<selector>`, `routeOf`, `label`. */
  readonly widened: readonly string[];
  readonly allowAttributes: readonly string[];
  readonly visibleSelector?: string;
  readonly routeOf?: (location: RouteLocation) => string;
  readonly label?: string;
}

/** Builds the frozen version 1 policy. Throws on attribute names that name an always-masked channel or are malformed. */
export function createPrivacyPolicy(options: PrivacyPolicyOptions = {}): PrivacyPolicy {
  const allow = [...new Set((options.allowAttributes ?? []).map(name => name.toLowerCase()))].sort();
  for (const name of allow) {
    if (!ATTRIBUTE_NAME.test(name)) throw new TypeError(`Not an attribute name: ${JSON.stringify(name)}`);
    if (NEVER_ALLOWED.test(name)) throw new TypeError(`The ${name} attribute is always masked and cannot be allowed`);
  }
  const extra = allow.filter(name => !DEFAULT_KEPT_ATTRIBUTES.includes(name));
  const widened: string[] = extra.map(name => `allowAttributes:${name}`);
  const policy: { -readonly [K in keyof PrivacyPolicy]: PrivacyPolicy[K] } = { version: 1, widened, allowAttributes: Object.freeze(extra) };
  if (options.visibleSelector !== undefined) {
    const selector = options.visibleSelector.trim();
    if (!selector) throw new TypeError('visibleSelector must not be empty');
    policy.visibleSelector = selector;
    widened.push(`visibleSelector:${selector}`);
  }
  if (options.routeOf !== undefined) {
    if (typeof options.routeOf !== 'function') throw new TypeError('routeOf must be a function');
    policy.routeOf = options.routeOf;
    widened.push('routeOf');
  }
  if (options.label !== undefined) {
    policy.label = String(options.label);
    widened.push('label');
  }
  Object.freeze(widened);
  return Object.freeze(policy);
}

/** The policy as a report records it (`observed.policy` in `feedback@1`). */
export function policyRecord(policy: PrivacyPolicy): { readonly version: number; readonly widened: readonly string[] } {
  return Object.freeze({ version: policy.version, widened: Object.freeze([...policy.widened]) });
}

/** The document title as it may leave the page: only the application's label, never `document.title`. */
export function titleFor(policy: PrivacyPolicy): string | undefined {
  return policy.label;
}

/** `*` of equal length, per code point. */
export function maskText(text: string): string {
  return '*'.repeat(Array.from(text).length);
}

/** Whitespace runs collapse to one space; ends are trimmed. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A kept attribute value with three or more digits in a row, or an `@`, is dropped. */
export function keptValue(value: string): boolean {
  return !/\d{3}/.test(value) && !value.includes('@');
}

/** `data-source` is code, not page data: a project-relative `path:line` (WP8's development stamp)
 * is kept whatever its line number; anything else (absolute, parent, URL, `@`, odd characters) is dropped. */
export const SOURCE_LOCATION = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|:))[\w.$+()[\]-]+(?:\/[\w.$+()[\]-]+)*\.[cm]?[jt]sx?:[1-9]\d{0,6}$/;
export function keptAttributeValue(name: string, value: string): boolean {
  return name === 'data-source' ? SOURCE_LOCATION.test(value) : keptValue(value);
}

const closest = (element: Element, selector: string): boolean => {
  try { return element.closest(selector) !== null; }
  catch { return false; } // An invalid selector widens nothing.
};

/** True when the element or an ancestor marks a visible region. */
export function inVisibleRegion(element: Element, policy: PrivacyPolicy): boolean {
  if (closest(element, `[${FEEDBACK_VISIBLE_ATTRIBUTE}]`)) return true;
  return policy.visibleSelector !== undefined && closest(element, policy.visibleSelector);
}

/** True when the element is, or is inside, an ignored subtree or the picker overlay. */
export function isExcluded(element: Element): boolean {
  return closest(element, `[${FEEDBACK_IGNORE_ATTRIBUTE}],[${FEEDBACK_OVERLAY_ATTRIBUTE}]`);
}

const VALUE_CONTAINERS = new Set(['textarea', 'select', 'option', 'optgroup', 'datalist', 'output', 'input']);

/** Form values, `textarea` and `contenteditable` content: masked even inside a visible region. */
export function isAlwaysMasked(element: Element): boolean {
  for (let current: Element | null = element; current; current = current.parentElement) {
    if (VALUE_CONTAINERS.has(current.localName)) return true;
    const editable = current.getAttribute('contenteditable');
    if (editable !== null && editable.toLowerCase() !== 'false') return true;
  }
  return false;
}

/** The allowed attributes of one element, keys sorted. */
export function allowedAttributes(element: Element, policy: PrivacyPolicy): Readonly<Record<string, string>> {
  const visible = inVisibleRegion(element, policy);
  const names: string[] = [];
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    if (DEFAULT_KEPT_ATTRIBUTES.includes(name) || policy.allowAttributes.includes(name) || (visible && VISIBLE_REGION_ATTRIBUTES.includes(name))) names.push(name);
  }
  const attrs: Record<string, string> = {};
  for (const name of [...new Set(names)].sort()) {
    const value = element.getAttribute(name);
    if (value !== null && keptAttributeValue(name, value)) attrs[name] = value;
  }
  return attrs;
}
