/**
 * Compact relative age used by every session surface (left-pane rows, the
 * session browser): "now", "8m", "3h", "2d", "5w", "7mo", "2y".
 *
 * One helper, one vocabulary — two copies previously disagreed above 52 weeks.
 */
export function formatRelativeAge(
  updatedAt: string | number | Date | undefined | null,
  now: number = Date.now(),
): string | null {
  if (updatedAt === null || updatedAt === undefined) return null
  const then = updatedAt instanceof Date
    ? updatedAt.getTime()
    : typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt)
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(days / 365)}y`
}
