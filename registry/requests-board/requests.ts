/** Host-owned request projections, not execution state or approval authority. `since` is an ISO timestamp of the last move. */
export type RequestState = 'question' | 'try' | 'validation' | 'building' | 'checking' | 'live' | 'abandoned';
export type RequestFilter = 'yours' | 'active' | 'live' | 'abandoned';
export type RequestQuestion = { readonly kind: 'answer' | 'approval' | 'release'; readonly text: string };
export interface RequestAction { readonly kind: 'preview' | 'pr'; readonly href: string }
export interface RequestLink { readonly kind: 'parent' | 'child' | 'blocked_by'; readonly number: string }
export interface RequestView {
  readonly number: string;
  readonly title: string;
  readonly state: RequestState;
  readonly line: string;
  readonly since: string;
  readonly waitsOn?: string;
  readonly question?: RequestQuestion;
  readonly action?: RequestAction;
  readonly links: readonly RequestLink[];
  readonly history: readonly { readonly at: string; readonly text: string }[];
  readonly repo?: string;
  readonly master?: string;
}
export const requestFilters: readonly RequestFilter[] = ['yours', 'active', 'live', 'abandoned'];
const matches = (view: RequestView, filter: RequestFilter) => filter === 'yours' ? Boolean(view.question) : filter === 'active' ? view.state !== 'live' && view.state !== 'abandoned' : view.state === filter;
const recent = (a: RequestView, b: RequestView) => (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0);

/** Questions first, then versions to try, then the most recently moved; never mutate the host's array. */
export function compactRows(views: readonly RequestView[]): readonly RequestView[] {
  const rank = (view: RequestView) => view.question ? 0 : view.state === 'try' ? 1 : 2;
  return [...views].sort((a, b) => rank(a) - rank(b) || recent(a, b)).slice(0, 5);
}
export function filterViews(views: readonly RequestView[], filter: RequestFilter, query: string, repo?: string): readonly RequestView[] {
  const search = query.trim().toLocaleLowerCase();
  return views.filter(view => matches(view, filter) && (!repo || view.repo === repo) && `${view.number} ${view.title} ${view.line}`.toLocaleLowerCase().includes(search)).sort(recent);
}
/** Counts use the same search and repository scope as the list. */
export function requestCounts(views: readonly RequestView[], query = '', repo?: string): Readonly<Record<RequestFilter, number>> {
  return Object.fromEntries(requestFilters.map(filter => [filter, filterViews(views, filter, query, repo).length])) as Record<RequestFilter, number>;
}
