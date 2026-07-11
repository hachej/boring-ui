export function normalizeSessionTitle(title: string): string {
  const normalized = title.replace(/[\r\n]+/g, " ").trim()
  if (!normalized) throw new Error("session title is required")
  if (normalized.length > 200) throw new Error("session title must be at most 200 characters")
  return normalized
}
