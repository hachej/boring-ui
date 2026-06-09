export type UnsafeRuntimePathSegment = "." | ".." | "\\"

export function findUnsafeRuntimePathSegment(path: string): UnsafeRuntimePathSegment | null {
  if (path.includes("\\")) return "\\"
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "..") return segment
  }
  return null
}

export function describeUnsafeRuntimePathSegment(segment: UnsafeRuntimePathSegment): string {
  if (segment === "\\") return "backslashes"
  return `${segment} segments`
}
