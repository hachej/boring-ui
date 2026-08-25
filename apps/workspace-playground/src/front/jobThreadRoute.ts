/**
 * `?jobThread=1` — the Job Thread v0 communication spike.
 *
 * Sibling of `consoleSpikeRoute`: a query-string route, not a path, so the
 * spike costs the playground nothing when it is off and needs no router.
 */
export function isJobThreadRoute(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === "undefined" ? "" : window.location.search)
  return new URLSearchParams(resolvedSearch).get("jobThread") === "1"
}
