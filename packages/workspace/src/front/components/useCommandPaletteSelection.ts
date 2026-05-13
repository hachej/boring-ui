import { useCallback, useMemo } from 'react'
import type { CatalogConfig } from '../../shared/plugins/types'
import type { CommandConfig } from '../registry/types'
import type { ExplorerRow } from './DataExplorer/types'
import {
  addCatalogToRecent,
  addCommandToRecent,
  loadRecent,
} from './recent'
import type { RecentEntry } from './recent'
import { filterAvailableRecentEntries } from './CommandPalette.helpers'

export function useCommandPaletteSelection({
  catalogs,
  commands,
  isCommandMode,
  searchQuery,
  close,
}: {
  catalogs: readonly CatalogConfig[]
  commands: readonly CommandConfig[]
  isCommandMode: boolean
  searchQuery: string
  close: () => void
}): {
  recentEntries: RecentEntry[]
  handleCatalogSelect: (catalog: CatalogConfig, row: ExplorerRow) => void
  handleCommandSelect: (cmd: CommandConfig) => void
  handleRecentSelect: (entry: RecentEntry) => void
} {
  const recentEntries = useMemo((): RecentEntry[] => {
    if (isCommandMode || searchQuery) return []
    return filterAvailableRecentEntries(loadRecent(), catalogs, commands)
  }, [isCommandMode, searchQuery, catalogs, commands])

  const handleCatalogSelect = useCallback((catalog: CatalogConfig, row: ExplorerRow) => {
    addCatalogToRecent(catalog.id, row)
    catalog.onSelect(row)
    close()
  }, [close])

  const handleCommandSelect = useCallback(
    (cmd: CommandConfig) => {
      addCommandToRecent(cmd.id, cmd.title)
      cmd.run()
      close()
    },
    [close],
  )

  const handleRecentSelect = useCallback((entry: RecentEntry) => {
    if (entry.type === 'catalog') {
      const catalog = catalogs.find((c) => c.id === entry.catalogId)
      if (catalog) {
        addCatalogToRecent(catalog.id, entry.rowSnapshot)
        catalog.onSelect(entry.rowSnapshot)
      }
    } else {
      const cmd = commands.find((c) => c.id === entry.commandId)
      if (cmd) {
        addCommandToRecent(cmd.id, cmd.title)
        cmd.run()
      }
    }
    close()
  }, [catalogs, commands, close])

  return {
    recentEntries,
    handleCatalogSelect,
    handleCommandSelect,
    handleRecentSelect,
  }
}
