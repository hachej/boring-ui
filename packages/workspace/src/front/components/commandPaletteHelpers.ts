import type { CatalogConfig, CatalogRow } from '../../shared/plugins/types'
import type { CommandConfig } from '../registry/types'
import type { RecentEntry } from './recent'

export const MAX_RESULTS = 50
export const CATALOG_MODE_LABEL = 'Catalogs'

export type PaletteMode = 'chats' | 'catalogs' | 'commands'

export interface CatalogSearchGroup {
  catalog: CatalogConfig
  rows: CatalogRow[]
  loading: boolean
  error?: string
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Search failed'
}

export function isActiveCommand(cmd: CommandConfig): boolean {
  if (!cmd.when) return true
  try {
    return cmd.when()
  } catch {
    return false
  }
}

export function searchCommands(commands: readonly CommandConfig[], searchQuery: string): CommandConfig[] {
  const active = commands.filter(isActiveCommand)
  if (!searchQuery) return active.slice(0, MAX_RESULTS)
  const lower = searchQuery.toLowerCase()
  return active.filter((c) => {
    if (c.title.toLowerCase().includes(lower)) return true
    return c.keywords?.some((keyword) => keyword.toLowerCase().includes(lower)) ?? false
  }).slice(0, MAX_RESULTS)
}

export function filterAvailableRecentEntries(
  entries: RecentEntry[],
  catalogs: readonly CatalogConfig[],
  commands: readonly CommandConfig[],
): RecentEntry[] {
  return entries.filter((entry) => {
    if (entry.type === 'catalog') {
      return catalogs.some((c) => c.id === entry.catalogId)
    }
    const cmd = commands.find((c) => c.id === entry.commandId)
    return Boolean(cmd) && isActiveCommand(cmd!)
  })
}
