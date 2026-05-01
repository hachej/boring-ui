export function readStoredBoolean(
  key: string,
  fallback: boolean,
  enabled = true,
): boolean {
  if (!enabled || typeof window === "undefined") return fallback
  try {
    const value = window.localStorage.getItem(key)
    if (value === "1") return true
    if (value === "0") return false
  } catch {
    // Storage may be unavailable in private/locked-down contexts.
  }
  return fallback
}

export function writeStoredBoolean(
  key: string,
  value: boolean,
  enabled = true,
): void {
  if (!enabled || typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value ? "1" : "0")
  } catch {
    // Best-effort persistence only.
  }
}

export function readStoredNumber(
  key: string,
  fallback: number,
  enabled = true,
): number {
  if (!enabled || typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  } catch {
    // Storage may be unavailable in private/locked-down contexts.
  }
  return fallback
}

export function writeStoredNumber(
  key: string,
  value: number,
  enabled = true,
): void {
  if (!enabled || typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, String(Math.round(value)))
  } catch {
    // Best-effort persistence only.
  }
}
