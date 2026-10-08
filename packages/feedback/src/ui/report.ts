// List and report data for `FeedbackList` and `FeedbackReport`: plain values derived from the stored reports and their list items, with the
// store's protection stated (FEEDBACK-1). The host fetches them through its own authorized routes.
import { isHostObserved, reportTitle, type FeedbackListItem, type FeedbackReport, type FeedbackStatus } from '../format/index.js';

export type FeedbackProtection = 'protected' | 'unprotected';

/** The sentence every surface shows for an unprotected store; nothing for a protected one. */
export function protectionNotice(protection: FeedbackProtection): string | undefined {
  return protection === 'unprotected' ? 'This feedback is stored where working tools, shell and Git can change it: the store is unprotected.' : undefined;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" relative to `now`. */
export function ageOf(created: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(created)) / 1000));
  if (!Number.isFinite(seconds) || seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export interface FeedbackRow {
  readonly id: string;
  readonly title: string;
  readonly status: FeedbackStatus;
  /** `northwind-console /settings/:section` for host subjects; the raw key otherwise. */
  readonly where: string;
  readonly author: string;
  readonly age: string;
}

/** `host:app-page:<app>:<route>` (parts URI-encoded by `subjectKeyOf`) as `<app> <route>`. */
export function subjectLabel(key: string): string {
  const match = /^host:([^:]*):([^:]*):(.*)$/.exec(key);
  if (!match) return key;
  const decode = (part: string): string => { try { return decodeURIComponent(part); } catch { return part; } };
  return `${decode(match[2] ?? '')} ${decode(match[3] ?? '')}`.trim();
}

export function listRows(items: readonly FeedbackListItem[], now: Date = new Date()): readonly FeedbackRow[] {
  return Object.freeze(items.map(item => Object.freeze({
    id: item.id, title: item.title || '(no text)', status: item.status, where: subjectLabel(item.subject), author: item.author, age: ageOf(item.created, now),
  })));
}

export interface ReportAnchorView {
  readonly index: number;
  readonly kind: string;
  readonly fallback: string;
  /** Development source location, when the anchor carries one. */
  readonly source?: string;
  /** Whether this page can place it (Show). */
  readonly placeable: boolean;
}

export interface ReportView {
  readonly id: string;
  readonly title: string;
  readonly said: string;
  /** The report's notes, each with the fallback of the anchor it is about (none for a general note). */
  readonly notes: readonly { readonly number: number; readonly text: string; readonly anchor?: number; readonly fallback?: string; readonly voice: boolean }[];
  readonly status: FeedbackStatus;
  readonly author?: string;
  readonly created: string;
  readonly app?: string;
  readonly route?: string;
  readonly build?: string;
  readonly widened: readonly string[];
  readonly anchors: readonly ReportAnchorView[];
  readonly resolutions: FeedbackReport['resolutions'];
}

export function reportView(report: FeedbackReport, placeable: (kind: string) => boolean = kind => kind === 'app.element@1'): ReportView {
  const observed = report.observed;
  const host = isHostObserved(observed) ? observed : undefined;
  const title = reportTitle(report) || '(no text)';
  const notes = (report.notes ?? []).map((note, index) => {
    const fallback = note.anchor !== undefined ? report.anchors[note.anchor]?.fallback : undefined;
    return Object.freeze({ number: index + 1, text: note.text, ...(note.anchor !== undefined ? { anchor: note.anchor } : {}), ...(fallback !== undefined ? { fallback } : {}), voice: note.from === 'voice' });
  });
  return Object.freeze({
    id: report.id, title, said: report.said, notes: Object.freeze(notes), status: report.status, created: report.created,
    ...(report.author ? { author: report.author.display || report.author.principalId } : {}),
    ...(host ? { app: host.subject.app, route: host.subject.route, ...(host.subject.build !== undefined ? { build: host.subject.build } : {}) } : {}),
    widened: Object.freeze([...(host?.policy.widened ?? [])]),
    anchors: Object.freeze(report.anchors.map((anchor, index) => {
      const signals = anchor['signals'];
      const source = typeof signals === 'object' && signals !== null && !Array.isArray(signals) ? (signals as Readonly<Record<string, unknown>>)['source'] : undefined;
      return Object.freeze({ index, kind: anchor.kind, fallback: anchor.fallback, ...(typeof source === 'string' ? { source } : {}), placeable: placeable(anchor.kind) });
    })),
    resolutions: report.resolutions,
  });
}
