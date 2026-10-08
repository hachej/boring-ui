// Annotate state (FEEDBACK.md, "Release 1: application pages"): the pinned elements become `app.element@1` anchors and a `host`
// observation from ONE masked page snapshot, the person types what they want to say, and the draft is copied (no store, no agent:
// FEEDBACK-2, FEEDBACK-5) or saved through the host's endpoint with one operation id per draft across retries.
import { copyToClipboard, randomUUID } from '@hachej/boring-files/platform';
import { draftReport, feedbackText, FEEDBACK_LIMITS, type FeedbackAnchor, type FeedbackDraft, type HostObserved } from '../format/index.js';
import { anchorOf, pageDigest, policyRecord, routeFor, serializePage, type AppDomSnapshot, type PrivacyPolicy, type RouteLocation } from '../page/index.js';
import type { SaveEndpoint, SaveResult } from './save.js';
import { createState, type ExternalState } from './state.js';

/** What the host tells annotation about its page. `app` and `build` are the host's; the route comes from the policy. */
export interface AnnotateHost {
  readonly app: string;
  readonly build?: string;
  /** The application root: the only pickable and serialized part of the page. */
  readonly root: Element;
  readonly policy: PrivacyPolicy;
  /** The current location; defaults to the root's window location. Only its path reaches `routeFor`. */
  readonly location?: () => RouteLocation;
}

export interface AnnotationCapture {
  readonly observed: HostObserved;
  readonly anchors: readonly FeedbackAnchor[];
  /** Pinned elements that could not be anchored, by pin position, with the reason. */
  readonly refused: readonly { readonly index: number; readonly reason: string }[];
  /** The one page snapshot every anchor and the digest came from. */
  readonly snapshot: AppDomSnapshot;
}

/** What was observed now: one masked page snapshot and the `host` observation (subject, route template, digest and policy). */
export async function observePage(host: AnnotateHost): Promise<{ readonly observed: HostObserved; readonly snapshot: AppDomSnapshot }> {
  const { root, policy } = host;
  const snapshot = serializePage(root, policy);
  const digest = await pageDigest(snapshot);
  const location = host.location?.() ?? root.ownerDocument.defaultView?.location ?? { pathname: '/' };
  const observed: HostObserved = {
    kind: 'host',
    subject: { type: 'app-page', app: host.app, route: routeFor({ pathname: location.pathname }, policy), ...(host.build !== undefined ? { build: host.build } : {}) },
    snapshot: snapshot.format,
    digest: `sha256:${digest}`,
    policy: policyRecord(policy),
  };
  return { observed, snapshot };
}

/** Anchors every pinned element against one masked page snapshot and records what was observed: subject, digest and policy. */
export async function captureAnnotation(host: AnnotateHost, elements: readonly Element[]): Promise<AnnotationCapture> {
  const { root, policy } = host;
  const { observed, snapshot } = await observePage(host);
  const anchors: FeedbackAnchor[] = [];
  const refused: { readonly index: number; readonly reason: string }[] = [];
  elements.slice(0, FEEDBACK_LIMITS.anchors).forEach((element, index) => {
    const captured = anchorOf(element, policy, { root, page: snapshot });
    if (captured.kind === 'captured') anchors.push(captured.anchor as unknown as FeedbackAnchor);
    else refused.push({ index, reason: captured.reason });
  });
  if (elements.length > FEEDBACK_LIMITS.anchors) refused.push({ index: FEEDBACK_LIMITS.anchors, reason: `at most ${FEEDBACK_LIMITS.anchors} elements per report` });
  return Object.freeze({ observed, anchors: Object.freeze(anchors), refused: Object.freeze(refused), snapshot });
}

export type CopyState =
  | { readonly kind: 'idle' }
  /** On the clipboard. The text is kept so the sheet can show what was copied. */
  | { readonly kind: 'copied'; readonly text: string }
  /** The clipboard refused: the sheet shows the text for a manual copy. */
  | { readonly kind: 'manual'; readonly text: string }
  | { readonly kind: 'refused'; readonly reason: string };

export type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | SaveResult;

export interface AnnotationSnapshot {
  readonly said: string;
  readonly anchors: readonly FeedbackAnchor[];
  readonly refused: readonly { readonly index: number; readonly reason: string }[];
  readonly observed: HostObserved;
  /** Every anchor's fallback, for the sheet ("the «Save» button"). */
  readonly targets: readonly string[];
  readonly copy: CopyState;
  readonly save: SaveState;
  /** False without a host save endpoint: the sheet shows Copy only. */
  readonly canSave: boolean;
  /** The operation id the next Save sends; it stays the same across retries of this draft. */
  readonly operationId: string;
}

export interface Annotation extends ExternalState<AnnotationSnapshot> {
  readonly setSaid: (said: string) => void;
  readonly draft: () => FeedbackDraft;
  /** Copy report: the never-stored report rendered through `./format`, on the clipboard. Needs no store, route or agent. */
  readonly copy: () => Promise<CopyState>;
  /** Save through the host endpoint, when there is one. */
  readonly save: () => Promise<SaveState>;
}

export interface AnnotationOptions {
  readonly capture: AnnotationCapture;
  readonly save?: SaveEndpoint;
  readonly said?: string;
  readonly now?: () => Date;
  /** Defaults to `copyToClipboard` from `@hachej/boring-files/platform`. */
  readonly copyText?: (text: string) => Promise<boolean>;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A `feedback@1` id for a report that is only copied, never stored. */
export function draftId(): string {
  let out = '';
  while (out.length < 16) {
    const hex = randomUUID().replace(/-/g, '');
    const random = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17);
    for (let at = 0; at + 2 <= random.length && out.length < 16; at += 2) {
      const byte = Number.parseInt(random.slice(at, at + 2), 16);
      if (byte < 232) out += BASE58[byte % 58];
    }
  }
  return `fb_${out}`;
}
/** A fresh Save operation id for one draft. */
export const operationId = (): string => `draft_${randomUUID()}`;

/** The headless annotate sheet. */
export function createAnnotation({ capture, save, said = '', now = () => new Date(), copyText = copyToClipboard }: AnnotationOptions): Annotation {
  const state = createState<AnnotationSnapshot>({
    said, anchors: capture.anchors, refused: capture.refused, observed: capture.observed,
    targets: Object.freeze(capture.anchors.map(anchor => String(anchor['fallback'] ?? ''))),
    copy: { kind: 'idle' }, save: { kind: 'idle' }, canSave: save !== undefined, operationId: operationId(),
  });
  // Whether the current operation id may have reached the store with some text: then it is kept even when the text changes, and the
  // store answers honestly (the original report for the same draft, a conflict for a changed one). Only definite refusals free it.
  let sent = false;

  const draft = (): FeedbackDraft => {
    const current = state.getSnapshot();
    return { observed: current.observed, anchors: current.anchors, said: current.said };
  };
  const problem = (): string | undefined => {
    const current = state.getSnapshot();
    if (!current.said.trim()) return 'Write what you want to say first.';
    if (!current.anchors.length) return 'No element could be anchored.';
    return undefined;
  };

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    draft,
    setSaid: next => {
      const current = state.getSnapshot();
      if (next === current.said) return;
      const settled = current.save.kind === 'saved';
      state.set({
        said: next, copy: { kind: 'idle' },
        ...(settled ? {} : { save: { kind: 'idle' } as SaveState }),
        ...(!sent && !settled ? { operationId: operationId() } : {}),
      });
    },
    copy: async () => {
      const refused = problem();
      if (refused) return state.set({ copy: { kind: 'refused', reason: refused } }).copy;
      let text: string;
      try { text = feedbackText(draftReport(draft(), { id: draftId(), created: now().toISOString() })); }
      catch (error) { return state.set({ copy: { kind: 'refused', reason: error instanceof Error ? error.message : 'The report could not be rendered.' } }).copy; }
      let copied = false;
      try { copied = await copyText(text); } catch { copied = false; }
      return state.set({ copy: copied ? { kind: 'copied', text } : { kind: 'manual', text } }).copy;
    },
    save: async () => {
      const current = state.getSnapshot();
      if (!save) return state.set({ save: { kind: 'unavailable', reason: 'This page has no place to save feedback; use Copy.' } }).save;
      if (current.save.kind === 'saving' || current.save.kind === 'saved') return current.save;
      const refused = problem();
      if (refused) return state.set({ save: { kind: 'invalid', reason: refused } }).save;
      state.set({ save: { kind: 'saving' } });
      sent = true;
      let result: SaveResult;
      try { result = await save({ operationId: current.operationId, draft: draft() }); }
      catch { result = { kind: 'unknown', reason: 'The save did not answer; Save again to reconcile it.' }; }
      // Definite refusals stored nothing: the next attempt may use a fresh id if the text changes.
      if (result.kind === 'denied' || result.kind === 'unavailable' || result.kind === 'invalid') sent = false;
      return state.set({ save: result }).save;
    },
  };
}
