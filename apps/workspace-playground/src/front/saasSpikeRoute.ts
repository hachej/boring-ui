/**
 * `?saasSpike=1` — fixture-only hybrid SaaS + Agent SaaS communication spike.
 *
 * This query-string route bypasses the live workspace host so the demo never
 * provisions a workspace or calls an API.
 */
export function isSaasSpikeRoute(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === "undefined" ? "" : window.location.search)
  const value = new URLSearchParams(resolvedSearch).get("saasSpike")
  // Demo default: this server exists to show the spike, so the bare URL opens
  // it too; `?saasSpike=0` opts back into the normal playground.
  return value !== "0"
}
