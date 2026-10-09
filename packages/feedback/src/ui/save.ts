// The human Save path (FEEDBACK.md, "Storage": operations and replay). The browser keeps one operation id per draft across retries and
// sends it with the draft; the host route admits it with the request's access (`store.operationKey('create', draft, access)`) and calls
// `store.create`. This module holds the wire shapes on both sides and imports no store code: the route maps the store's result itself.
import { draftProblems, type FeedbackDraft, type FeedbackReport } from '../format/index.js';

/** What the browser sends. */
export interface SaveRequest {
  /** Stable across retries of one draft. */
  readonly operationId: string;
  readonly draft: FeedbackDraft;
}

/** What the host answers. `unknown` means the outcome is not known: retry later with the same operation id to reconcile. */
export type SaveResult =
  | { readonly kind: 'saved'; readonly id: string; readonly revision: string }
  | { readonly kind: 'denied' | 'unavailable' | 'conflict' | 'unknown' | 'invalid'; readonly reason: string };

/** The host's save endpoint, as the annotate state calls it. A throw counts as `unknown`. */
export type SaveEndpoint = (request: SaveRequest) => Promise<SaveResult>;

const OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const REFUSALS = new Set(['denied', 'unavailable', 'conflict', 'unknown', 'invalid']);

/** A save endpoint over Fetch: POSTs the request as JSON to `url` and reads a `SaveResult` back. Transport failures are `unknown`. */
export function fetchSaveEndpoint(url: string | URL, fetcher: (request: Request) => Promise<Response> = request => fetch(request)): SaveEndpoint {
  return async request => {
    let response: Response;
    try {
      response = await fetcher(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }));
    } catch { return { kind: 'unknown', reason: 'The save request did not complete; retrying reconciles it.' }; }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    return saveResultOf(body) ?? (response.status === 401 || response.status === 403
      ? { kind: 'denied', reason: 'You are not signed in or may not leave feedback here.' }
      : { kind: 'unknown', reason: `The save answered ${response.status}; retrying reconciles it.` });
  };
}

/** A well-formed `SaveResult`, or undefined. */
export function saveResultOf(value: unknown): SaveResult | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (record['kind'] === 'saved' && typeof record['id'] === 'string' && typeof record['revision'] === 'string') return { kind: 'saved', id: record['id'], revision: record['revision'] };
  if (typeof record['kind'] === 'string' && REFUSALS.has(record['kind']) && typeof record['reason'] === 'string') return { kind: record['kind'] as Exclude<SaveResult['kind'], 'saved'>, reason: record['reason'] };
  return undefined;
}

/** For the host route: the request body as a `SaveRequest`, or the reason it is refused. The draft is fully checked by `store.create`. */
export function parseSaveRequest(value: unknown): { readonly ok: true; readonly request: SaveRequest } | { readonly ok: false; readonly reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, reason: 'The request must be a JSON object' };
  const record = value as Readonly<Record<string, unknown>>;
  const extra = Object.keys(record).filter(key => key !== 'operationId' && key !== 'draft');
  if (extra.length) return { ok: false, reason: `Unexpected fields: ${extra.join(', ')}` };
  const operationId = record['operationId'];
  if (typeof operationId !== 'string' || !OPERATION_ID.test(operationId)) return { ok: false, reason: 'operationId must be 8 to 128 letters, digits or _.:-' };
  const problems = draftProblems(record['draft']);
  if (problems.length) return { ok: false, reason: problems.map(problem => `${problem.at}: ${problem.message}`).join('; ') };
  return { ok: true, request: { operationId, draft: record['draft'] as FeedbackDraft } };
}

/** The store's create result (`@hachej/boring-feedback/store`), structurally, so this browser module needs no store import. */
export type StoreCreateResult =
  | { readonly kind: 'applied'; readonly report: FeedbackReport; readonly revision: string }
  | { readonly kind: 'denied' | 'unavailable' | 'conflict' | 'unknown'; readonly reason: string };

/** For the host route: the store's create result as the `SaveResult` the browser reads, with an HTTP status. */
export function saveResponseOf(result: StoreCreateResult): { readonly status: number; readonly body: SaveResult } {
  switch (result.kind) {
    case 'applied': return { status: 200, body: { kind: 'saved', id: result.report.id, revision: result.revision } };
    case 'denied': return { status: 403, body: { kind: 'denied', reason: result.reason } };
    case 'conflict': return { status: 409, body: { kind: 'conflict', reason: result.reason } };
    case 'unavailable': return { status: 503, body: { kind: 'unavailable', reason: result.reason } };
    default: return { status: 202, body: { kind: 'unknown', reason: result.reason } };
  }
}
