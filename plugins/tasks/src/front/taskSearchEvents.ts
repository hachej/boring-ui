export const TASK_SEARCH_QUERY_EVENT = "boring-tasks:set-search-query"
const TASK_SEARCH_STORAGE_KEY = "boring-tasks:search-query"

export function readTaskSearchQuery(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.sessionStorage.getItem(TASK_SEARCH_STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function publishTaskSearchQuery(query: string): void {
  const normalized = query.slice(0, 256)
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(TASK_SEARCH_STORAGE_KEY, normalized)
  } catch {}
  window.dispatchEvent(new CustomEvent(TASK_SEARCH_QUERY_EVENT, { detail: { query: normalized } }))
}

export function taskSearchQueryFromEvent(event: Event): string | null {
  const detail = (event as CustomEvent<unknown>).detail as { query?: unknown } | undefined
  return typeof detail?.query === "string" && detail.query.length <= 256 ? detail.query : null
}
