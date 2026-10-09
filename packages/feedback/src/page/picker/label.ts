// Picker labels and live lookups. Every word of a label comes through the privacy policy (FEEDBACK-8): the component name from a kept
// `data-source`, the role from kept structure, and the accessible name only when the policy allows it; otherwise "masked".
import { roleOf, type AppElementRange } from '../app-element.js';
import { accessibleNameOf } from '../privacy/name.js';
import { MASKED_NAME, isExcluded, type PrivacyPolicy } from '../privacy/policy.js';
import { serializeElement, type AppDomNode, type AppDomSnapshot } from '../privacy/serialize.js';

/** `src/settings/SaveBar.tsx:42` → `SaveBar`; an `index` file is named by its folder. */
export function componentOf(source: string): string | undefined {
  const file = source.replace(/:\d+$/, '');
  const parts = file.split('/');
  const base = (parts.at(-1) ?? '').replace(/\.[cm]?[jt]sx?$/, '');
  const name = base === 'index' && parts.length > 1 ? parts.at(-2) : base;
  return name || undefined;
}

/**
 * The overlay label of an element: `SaveBar · button «Save»` with a development source location, `button «Save»` without one, and
 * `button · masked` when the policy masks its name. Excluded elements are only ever `masked`.
 */
export function pickerLabel(element: Element, policy: PrivacyPolicy): string {
  if (isExcluded(element)) return MASKED_NAME;
  const node = serializeElement(element, policy, { subtreeLimit: 1 }).root;
  if (!node) return MASKED_NAME;
  const source = node.attrs['data-source'];
  const component = source === undefined ? undefined : componentOf(source);
  const role = roleOf(node) ?? node.tag;
  const name = accessibleNameOf(element, policy);
  const what = name === MASKED_NAME ? `${role} · ${MASKED_NAME}` : `${role} «${name}»`;
  return component ? `${component} · ${what}` : what;
}

/**
 * The live element at a range of a snapshot of `root`, following tags and same-tag positions, without scrolling or re-checking it.
 * For drawing numbered candidates only; revealing one goes through `revealElement`, which re-checks it against the snapshot.
 */
export function elementAt(range: AppElementRange, root: Element, snapshot: AppDomSnapshot): Element | undefined {
  let node: AppDomNode | null = snapshot.root;
  if (!node || node.tag !== root.localName) return undefined;
  let live: Element = root;
  for (const step of range) {
    const child: AppDomNode | undefined = node.children[step];
    if (child === undefined) return undefined;
    let seen = 0, found: Element | undefined;
    for (const candidate of Array.from(live.children)) {
      if (candidate.localName === child.tag && seen++ === child.index) { found = candidate; break; }
    }
    if (found === undefined) return undefined;
    live = found;
    node = child;
  }
  return isExcluded(live) ? undefined : live;
}
