export function normalizeServerRoutePrefix(value: string | undefined, label = "route prefix"): string {
  const trimmed = value?.trim() ?? ""
  if (!trimmed || /^\/+$/u.test(trimmed)) return ""
  if (!trimmed.startsWith("/") || /[?#]/u.test(trimmed)) {
    throw new TypeError(`${label} must be an absolute URL path without a query or fragment`)
  }
  const segments = trimmed.split("/").filter(Boolean)
  for (const segment of segments) {
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch {
      throw new TypeError(`${label} must contain valid percent-encoding`)
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new TypeError(`${label} must not contain traversal or encoded path separators`)
    }
  }
  return `/${segments.join("/")}`
}
