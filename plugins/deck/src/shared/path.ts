export function normalizeDeckPath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, "/")
  const noLeadingDot = trimmed.replace(/^\.\//, "")
  return noLeadingDot.replace(/\/+/g, "/")
}

export function isDeckMarkdownPath(path: string, pathPrefix = "deck/"): boolean {
  const normalized = normalizeDeckPath(path)
  const normalizedPathPrefix = normalizeDeckPath(pathPrefix)
  const normalizedPrefix = normalizedPathPrefix.endsWith("/") ? normalizedPathPrefix : `${normalizedPathPrefix}/`

  if (!normalized.endsWith(".md")) return false
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false
  if (normalized.split("/").some((segment) => segment === "..")) return false

  return normalized.startsWith(normalizedPrefix)
}
