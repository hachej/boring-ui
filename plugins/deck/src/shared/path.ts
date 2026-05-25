export function normalizeDeckPath(path: string): string {
  return path.replace(/\\/g, "/")
}
