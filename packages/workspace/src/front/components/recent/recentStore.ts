import type { RecentEntry } from "./types"
import type { ExplorerRow } from "../DataExplorer/types"
import { migrateRecent } from "./migrate"

const STORAGE_KEY = "boring-ui-v2:command-palette:recent"
const MAX_ENTRIES = 50

export function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const hasLegacy = parsed.some((e) => typeof e === "string")
    if (hasLegacy) {
      const migrated = migrateRecent(parsed).filter(isValidEntry).slice(0, MAX_ENTRIES)
      saveRecent(migrated)
      return migrated
    }
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

export function saveRecent(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    )
  } catch { /* quota */ }
}

export function addCatalogToRecent(
  catalogId: string,
  row: ExplorerRow,
): void {
  const entries = loadRecent().filter(
    (e) => !(e.type === "catalog" && e.catalogId === catalogId && e.rowId === row.id),
  )
  entries.unshift({
    type: "catalog",
    catalogId,
    rowId: row.id,
    rowSnapshot: row,
    selectedAt: Date.now(),
  })
  saveRecent(entries)
}

export function addCommandToRecent(
  commandId: string,
  title: string,
): void {
  const entries = loadRecent().filter(
    (e) => !(e.type === "command" && e.commandId === commandId),
  )
  entries.unshift({
    type: "command",
    commandId,
    titleSnapshot: title,
    selectedAt: Date.now(),
  })
  saveRecent(entries)
}

function isValidEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.type === "catalog") {
    return (
      typeof obj.catalogId === "string" &&
      typeof obj.rowId === "string" &&
      typeof obj.rowSnapshot === "object" &&
      obj.rowSnapshot !== null &&
      typeof obj.selectedAt === "number"
    )
  }
  if (obj.type === "command") {
    return (
      typeof obj.commandId === "string" &&
      typeof obj.titleSnapshot === "string" &&
      typeof obj.selectedAt === "number"
    )
  }
  return false
}

export { STORAGE_KEY, MAX_ENTRIES }
