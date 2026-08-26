/**
 * `?saasSpike=1` — fixture-only hybrid SaaS + Agent SaaS communication spike.
 *
 * This query-string route bypasses the live workspace host so the demo never
 * provisions a workspace or calls an API.
 */
export function isSaasSpikeRoute(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === "undefined" ? "" : window.location.search)
  return new URLSearchParams(resolvedSearch).get("saasSpike") === "1"
}
