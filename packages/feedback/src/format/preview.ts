// The answer of a page preview (FEEDBACK.md, "Preview"): what the browser subagent changed on the live page and the person approved,
// or that they discarded it. Built in the page (`@hachej/boring-feedback/preview`), checked again on the server (`browser_preview` in
// `@hachej/boring-feedback/agent`) before the builder reads it. Pure.

/** One approved change: the element as the privacy policy names it, its `data-source` location when kept, and the net change. */
export interface PreviewChange {
  /** The element's policy-safe fallback (`the «Save profile» button (SettingsPage.jsx:40)`). */
  readonly element: string;
  /** `path:line` from `data-source`, when the policy kept it. */
  readonly source?: string;
  /** A CSS property, or absent for a text change. */
  readonly property?: string;
  /** True for a text change. */
  readonly text?: true;
  readonly from: string;
  readonly to: string;
}

export type PreviewAnswer =
  | { readonly kind: 'approved'; readonly summary: string; readonly changes: readonly PreviewChange[] }
  | { readonly kind: 'discarded' };

export const PREVIEW_LIMITS = Object.freeze({ changes: 40, summary: 600, field: 300 });

/** The fields of a change (one string: the manifest check reads quoted words after `from` as module specifiers). */
const CHANGE_FIELDS = 'element source property text from to'.split(' ');
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;

/** Why `value` is not a `PreviewAnswer`, or undefined when it is. */
export function previewAnswerProblem(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'the answer must be an object';
  const answer = value as Record<string, unknown>;
  if (answer['kind'] === 'discarded') return Object.keys(answer).length === 1 ? undefined : 'a discarded preview carries nothing else';
  if (answer['kind'] !== 'approved') return 'kind must be approved or discarded';
  if (Object.keys(answer).sort().join() !== 'changes,kind,summary') return 'an approved preview has kind, summary and changes only';
  if (!isText(answer['summary'], PREVIEW_LIMITS.summary)) return `summary must be text of at most ${PREVIEW_LIMITS.summary} characters`;
  const changes = answer['changes'];
  if (!Array.isArray(changes) || changes.length > PREVIEW_LIMITS.changes) return `changes must be a list of at most ${PREVIEW_LIMITS.changes}`;
  for (const [index, item] of changes.entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return `change ${index} must be an object`;
    const change = item as Record<string, unknown>;
    if (Object.keys(change).some(key => !CHANGE_FIELDS.includes(key))) return `change ${index} has an unknown field`;
    const { element, source, property, text, from, to } = change;
    if (!isText(element, PREVIEW_LIMITS.field) || !element) return `change ${index} needs its element`;
    if (source !== undefined && !isText(source, PREVIEW_LIMITS.field)) return `change ${index} has an invalid source`;
    if ((property === undefined) === (text === undefined)) return `change ${index} changes either a property or the text`;
    if (property !== undefined && (!isText(property, 64) || !/^[a-z][a-z-]*$/.test(property))) return `change ${index} has an invalid property`;
    if (text !== undefined && text !== true) return `change ${index} has an invalid text flag`;
    if (!isText(from, PREVIEW_LIMITS.field) || !isText(to, PREVIEW_LIMITS.field)) return `change ${index} needs from and to`;
  }
  return undefined;
}
