export interface ChatPaneState {
  workspaceId: string
  ids: string[]
  activeId: string | null
}

export function createdSessionId(value: unknown): string | null {
  return typeof (value as { id?: unknown } | null | undefined)?.id === "string"
    ? (value as { id: string }).id
    : null
}

export function insertPaneAfter(ids: string[], afterId: string | null | undefined, nextId: string): string[] {
  if (ids.includes(nextId)) return ids
  const index = afterId ? ids.indexOf(afterId) : -1
  const insertAt = index >= 0 ? index + 1 : ids.length
  return [...ids.slice(0, insertAt), nextId, ...ids.slice(insertAt)]
}

export function replaceActivePane(ids: string[], activeId: string | null | undefined, nextId: string): string[] {
  if (ids.includes(nextId)) return ids
  if (ids.length === 0) return [nextId]
  const index = activeId ? ids.indexOf(activeId) : -1
  const replaceAt = index >= 0 ? index : 0
  return ids.map((id, currentIndex) => currentIndex === replaceAt ? nextId : id)
}
