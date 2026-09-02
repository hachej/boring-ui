export function isConsoleSpikeRoute(search?: string): boolean {
  const resolvedSearch = search ?? (typeof window === "undefined" ? "" : window.location.search)
  return new URLSearchParams(resolvedSearch).get("consoleSpike") === "1"
}
