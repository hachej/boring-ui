import type { RecentEntry } from "./types"

export function migrateRecent(parsed: unknown[]): RecentEntry[] {
  const now = Date.now()
  const migrated: RecentEntry[] = []

  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (entry.startsWith("cmd:")) {
        const commandId = entry.slice(4)
        migrated.push({
          type: "command",
          commandId,
          titleSnapshot: commandId,
          selectedAt: now,
        })
      } else {
        const lastSlash = entry.lastIndexOf("/")
        migrated.push({
          type: "catalog",
          catalogId: "files",
          rowId: entry,
          rowSnapshot: {
            id: entry,
            title: lastSlash >= 0 ? entry.slice(lastSlash + 1) : entry,
            subtitle: lastSlash >= 0 ? entry.slice(0, lastSlash + 1) : undefined,
          },
          selectedAt: now,
        })
      }
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry
    ) {
      migrated.push(entry as RecentEntry)
    }
  }

  return migrated
}
