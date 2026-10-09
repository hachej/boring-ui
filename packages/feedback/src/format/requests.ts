// Where reports live (`<root><id>.md`, one file per report, no index) and the single-file publication requests that create
// and resolve a report. Builders only shape requests: the store reads current revisions, authorizes, derives the author and publishes.
import type { PublicationRequest, ResourceChange, ResourceLocator, ResourceRef, ResourceView } from '@hachej/boring-files';
import {
  draftProblems, FEEDBACK_FORMAT, FEEDBACK_ID, FEEDBACK_MEDIA_TYPE, FeedbackFormatError,
  checkFeedback, serializeFeedback, reportTitle, draftBody,
} from './report.js';
import type { FeedbackAuthor, FeedbackDraft, FeedbackReport, FeedbackResolution, FeedbackStatus, Observed } from './report.js';

/** One listed report, derived from the report file itself (there is no index). */
export interface FeedbackListItem {
  readonly id: string;
  /** The report's resource path. */
  readonly path: string;
  readonly status: FeedbackStatus;
  readonly subject: string;
  readonly created: string;
  readonly title: string;
  /** The author's principal, as the host derived it when the report was stored. */
  readonly author: string;
}

/** The list item of a stored report. */
export function listItemOf(root: FeedbackRoot, report: FeedbackReport): FeedbackListItem {
  return { id: report.id, path: reportPath(root, report.id), status: report.status, subject: subjectKeyOf(report.observed), created: report.created, title: reportTitle(report), author: report.author?.principalId ?? '' };
}

const part = encodeURIComponent;

/** The index key that groups reports about the same subject: application and route for pages, provider and path for
 * resources (any view), the kind alone for kinds this version does not know. */
export function subjectKeyOf(observed: Observed): string {
  if (observed.kind === 'host') {
    const { subject } = observed as Extract<Observed, { readonly kind: 'host' }>;
    return `host:${part(subject.type)}:${part(subject.app)}:${part(subject.route)}`;
  }
  if (observed.kind === 'resource') {
    const { locator } = observed as Extract<Observed, { readonly kind: 'resource' }>;
    return `resource:${part(locator.resource.providerId)}:${part(locator.resource.path)}`;
  }
  return `other:${part(observed.kind)}`;
}

/** Where a store keeps its reports: `<path><id>.md`, one file per report, in one provider view. */
export interface FeedbackRoot {
  readonly providerId: string;
  readonly view: ResourceView;
  /** Empty or ending with `/`. */
  readonly path: string;
}

const fail = (at: string, message: string): never => { throw new FeedbackFormatError([{ code: 'schema', at, message }]); };

function checkRoot(root: FeedbackRoot) {
  if (!root.providerId) fail('root.providerId', 'is required');
  if (root.path && (!root.path.endsWith('/') || root.path.startsWith('/') || root.path.split('/').some(segment => segment === '..' || segment === '.'))) fail('root.path', 'must be empty or a relative folder ending with /');
}

const locator = (root: FeedbackRoot, path: string): ResourceLocator => ({ resource: { providerId: root.providerId, path }, view: root.view });
export const reportPath = (root: FeedbackRoot, id: string) => `${root.path}${id}.md`;
export const reportLocator = (root: FeedbackRoot, id: string) => locator(root, reportPath(root, id));

const sameView = (a: ResourceView, b: ResourceView) => a.kind === b.kind && (a.kind === 'published' || a.viewId === (b as { readonly viewId?: string }).viewId);
function checkRef(ref: ResourceRef, expected: ResourceLocator, at: string) {
  if (ref.resource.providerId !== expected.resource.providerId || ref.resource.path !== expected.resource.path || !sameView(ref.view, expected.view) || !ref.revision) {
    fail(at, `must name ${expected.resource.path} in the root's provider and view`);
  }
}

function request(operationId: string, change: ResourceChange): PublicationRequest {
  if (!operationId) fail('operationId', 'is required');
  return { operationId, atomicity: 'all-or-nothing', changes: [change] };
}

export interface FeedbackChange {
  readonly request: PublicationRequest;
  readonly report: FeedbackReport;
}

/** Create: the report file with `expected: absent`. `author` is the host-derived author; a draft carrying its own author is refused. */
export function createRequest(input: {
  readonly operationId: string;
  readonly root: FeedbackRoot;
  readonly draft: FeedbackDraft;
  readonly id: string;
  readonly created: string;
  readonly author: FeedbackAuthor;
}): FeedbackChange {
  checkRoot(input.root);
  const problems = draftProblems(input.draft);
  if (problems.length) throw new FeedbackFormatError(problems);
  const { draft, id, created, author, root } = input;
  if (!FEEDBACK_ID.test(id)) fail('id', 'invalid id');
  const checked = checkFeedback({ format: FEEDBACK_FORMAT, id, status: 'open', author, created, ...draftBody(draft), resolutions: [] });
  if (!checked.ok) throw new FeedbackFormatError(checked.problems);
  const report = checked.report;
  const change: ResourceChange = { kind: 'create', target: reportLocator(root, id), expected: { kind: 'absent' }, bytes: serializeFeedback(report), mediaType: FEEDBACK_MEDIA_TYPE };
  return { report, request: request(input.operationId, change) };
}

/** Resolve: the report, marked addressed with one more resolution entry, replaced at `current.ref`. Unknown kinds and `x-` fields
 * of the current report are carried over unchanged. */
export function resolveRequest(input: {
  readonly operationId: string;
  readonly root: FeedbackRoot;
  readonly current: { readonly ref: ResourceRef; readonly report: FeedbackReport };
  readonly resolution: FeedbackResolution;
}): FeedbackChange {
  checkRoot(input.root);
  const { root, current } = input;
  checkRef(current.ref, reportLocator(root, current.report.id), 'current.ref');
  const { at, by, note } = input.resolution;
  const checked = checkFeedback({ ...current.report, status: 'addressed', resolutions: [...current.report.resolutions, { at, by, note }] });
  if (!checked.ok) throw new FeedbackFormatError(checked.problems);
  const report = checked.report;
  return { report, request: request(input.operationId, { kind: 'replace', target: current.ref, bytes: serializeFeedback(report), mediaType: FEEDBACK_MEDIA_TYPE }) };
}
