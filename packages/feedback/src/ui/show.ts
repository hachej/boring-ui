// Show (FEEDBACK.md, "Pointing at elements" and "Activating it on an agent"): resolve a stored anchor against a FRESH snapshot of the
// live page, reveal only `exact` or `moved`, number `ambiguous` candidates and let the person choose, and say honestly when the element
// is missing, stale or of a kind this page cannot place (FEEDBACK-4, FEEDBACK-7). Nothing uncertain is revealed without that choice.
import {
  APP_ELEMENT_KIND, appElementResolution, elementAt, pageDigest, pickerLabel, revealElement, serializePage,
  type AppDomSnapshot, type AppElementAnchor, type AppElementRange, type PickerOverlay, type PrivacyPolicy,
} from '../page/index.js';

export interface ShowCandidate {
  /** 1-based, in the order resolution ranked them. */
  readonly number: number;
  /** The candidate's label from the privacy policy. */
  readonly label: string;
  readonly range: AppElementRange;
}

export type ShowOutcome =
  | { readonly kind: 'revealed'; readonly placement: 'exact' | 'moved' | 'chosen'; readonly element: Element; readonly evaluated: string }
  /** A person must choose: the candidates are numbered on the overlay and here. `choose` reveals one against the same snapshot. */
  | { readonly kind: 'choose'; readonly candidates: readonly ShowCandidate[]; readonly evaluated: string; readonly choose: (number: number) => ShowOutcome }
  | { readonly kind: 'stale'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reason: string; readonly evaluated: string }
  | { readonly kind: 'unsupported'; readonly reason: string };

export interface ShowOptions {
  readonly anchor: unknown;
  readonly root: Element;
  readonly policy: PrivacyPolicy;
  /** Draws the revealed element or the numbered candidates. Without it Show only scrolls. */
  readonly overlay?: PickerOverlay;
  /** The note drawn with a revealed element. */
  readonly note?: string;
}

const STALE_RETRIES = 1;

/** Resolves an anchor against the live page now. Exact and moved placements are revealed; ambiguous ones wait for the person. */
export async function showAnchor(options: ShowOptions): Promise<ShowOutcome> {
  const { root, policy, overlay, note } = options;
  const kind = typeof options.anchor === 'object' && options.anchor !== null ? (options.anchor as { readonly kind?: unknown }).kind : undefined;
  if (kind !== APP_ELEMENT_KIND) return { kind: 'unsupported', reason: `This page places ${APP_ELEMENT_KIND} anchors only${typeof kind === 'string' ? `, not ${kind}` : ''}.` };
  let anchor: AppElementAnchor;
  try { anchor = appElementResolution.schema.parse(options.anchor); }
  catch (error) { return { kind: 'unsupported', reason: error instanceof Error ? error.message : 'The anchor is not valid.' }; }

  for (let attempt = 0; ; attempt++) {
    const snapshot = serializePage(root, policy);
    const evaluated = await pageDigest(snapshot);
    const placement = appElementResolution.resolve(anchor, snapshot, evaluated);
    switch (placement.kind) {
      case 'exact':
      case 'moved': {
        const revealed = revealElement(placement.range, root, snapshot, policy);
        if (revealed.kind === 'revealed') {
          overlay?.highlight(revealed.element, note ?? anchor.fallback);
          return { kind: 'revealed', placement: placement.kind, element: revealed.element, evaluated };
        }
        // The page changed between resolve and reveal: resolve again against a fresh snapshot, once.
        if (attempt < STALE_RETRIES) continue;
        overlay?.clear();
        return { kind: 'stale', reason: revealed.reason };
      }
      case 'ambiguous':
        return choice(anchor, placement.candidates, root, snapshot, evaluated, policy, overlay, note);
      case 'missing':
        overlay?.clear();
        return { kind: 'missing', reason: `Nothing on this page matches ${anchor.fallback}.`, evaluated };
      default:
        overlay?.clear();
        return { kind: 'unsupported', reason: `This page cannot place the anchor (${placement.kind}).` };
    }
  }
}

function choice(anchor: AppElementAnchor, ranges: readonly AppElementRange[], root: Element, snapshot: AppDomSnapshot, evaluated: string,
  policy: PrivacyPolicy, overlay: PickerOverlay | undefined, note: string | undefined): ShowOutcome {
  const candidates: ShowCandidate[] = [];
  const marks: { element: Element; label: string; tone: 'candidate' }[] = [];
  ranges.forEach((range, index) => {
    const element = elementAt(range, root, snapshot);
    candidates.push(Object.freeze({ number: index + 1, label: element ? pickerLabel(element, policy) : 'not on screen', range }));
    // Numbers only: no candidate is scrolled to or singled out before the person chooses.
    if (element) marks.push({ element, label: String(index + 1), tone: 'candidate' });
  });
  overlay?.draw(marks);
  const choose = (number: number): ShowOutcome => {
    const picked = candidates[number - 1];
    if (!picked) return { kind: 'stale', reason: `There is no candidate ${number}.` };
    const revealed = revealElement(picked.range, root, snapshot, policy);
    if (revealed.kind !== 'revealed') { overlay?.clear(); return { kind: 'stale', reason: `${revealed.reason}; Show again.` }; }
    overlay?.highlight(revealed.element, note ?? anchor.fallback);
    return { kind: 'revealed', placement: 'chosen', element: revealed.element, evaluated };
  };
  return { kind: 'choose', candidates: Object.freeze(candidates), evaluated, choose };
}
