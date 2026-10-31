// The Audience screen's data and what it derives from it. Totals only: a visit is a count, a usage is a count; no person, address or file is here.

export interface LandingDay { readonly day: string; readonly visits: number; readonly refs: Readonly<Record<string, number>> }
export interface LandingTotals { readonly days: readonly LandingDay[]; readonly total: number; readonly refs: Readonly<Record<string, number>> }
/** One counter the app keeps itself (see README.md "Usage counts"): `kind` is `sample` (the sample file) or `own_file` (the person's own), or any other word the app counts. */
export interface UsageCount { readonly kind: string; readonly n: number }
/** A stranger's request for access, as the owner sees it. */
export interface AccessRequestRow { readonly email: string; readonly note: string; readonly createdAt: string; readonly revokedBefore: boolean }
/** What the app's `/api/audience` route answers (server/src/audience.ts): `landing` is null on a host without env.landing, `usage` null when the app keeps no counter. */
export interface AudienceData { readonly landing: LandingTotals | null; readonly usage: readonly UsageCount[] | null }

export interface RefRow { readonly ref: string; readonly visits: number; readonly share: number }
export interface DayRow { readonly day: string; readonly visits: number; readonly share: number }

/** The outreach links, most visited first (ties by name); `share` is the part of the busiest one, 0 to 100, for a bar. */
export function refRows(landing: LandingTotals | null): readonly RefRow[] {
  const entries = Object.entries(landing?.refs ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const top = entries[0]?.[1] ?? 0;
  return entries.map(([ref, visits]) => ({ ref, visits, share: top ? Math.round((visits / top) * 100) : 0 }));
}

/** The last `count` days, newest first, with a bar share against the busiest of them. A quiet stretch still shows its days. */
export function dayRows(landing: LandingTotals | null, count = 14): readonly DayRow[] {
  const last = (landing?.days ?? []).slice(-Math.max(1, count));
  const top = Math.max(0, ...last.map((d) => d.visits));
  return last.map((d) => ({ day: d.day, visits: d.visits, share: top ? Math.round((d.visits / top) * 100) : 0 })).reverse();
}

/** The visits through outreach links as a part of all visits, 0 to 100 (0 when there is none). */
export function outreachShare(landing: LandingTotals | null): number {
  if (!landing?.total) return 0;
  return Math.round((Object.values(landing.refs).reduce((a, b) => a + b, 0) / landing.total) * 100);
}

/** The count of one usage kind (0 when the app never counted it). */
export const usageOf = (usage: readonly UsageCount[] | null, kind: string): number => usage?.find((u) => u.kind === kind)?.n ?? 0;

/** `/api/audience` answer, checked: anything that is not the shape is dropped to null, never thrown into the page. */
export function readAudience(value: unknown): AudienceData {
  const v = (value ?? {}) as { landing?: unknown; usage?: unknown };
  const landing = v.landing as Partial<LandingTotals> | null | undefined;
  const okLanding = landing && Array.isArray(landing.days) && typeof landing.total === 'number' && landing.refs && typeof landing.refs === 'object';
  const usage = Array.isArray(v.usage) ? v.usage.filter((u): u is UsageCount => typeof u?.kind === 'string' && Number.isFinite(u?.n)) : null;
  return { landing: okLanding ? (landing as LandingTotals) : null, usage };
}
