import { useEffect, useState } from 'react'
import type { CatalogConfig } from '../../shared/plugins/types'
import {
  MAX_RESULTS,
  errorMessage,
  type CatalogSearchGroup,
} from './commandPaletteHelpers'

export function useCommandPaletteCatalogSearch({
  catalogs,
  isCommandMode,
  searchQuery,
}: {
  catalogs: readonly CatalogConfig[]
  isCommandMode: boolean
  searchQuery: string
}): CatalogSearchGroup[] {
  const [debouncedCatalogQuery, setDebouncedCatalogQuery] = useState('')
  const [catalogGroups, setCatalogGroups] = useState<CatalogSearchGroup[]>([])

  useEffect(() => {
    if (isCommandMode) {
      setDebouncedCatalogQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedCatalogQuery(searchQuery), 180)
    return () => clearTimeout(timer)
  }, [isCommandMode, searchQuery])

  useEffect(() => {
    if (isCommandMode || !debouncedCatalogQuery) {
      setCatalogGroups([])
      return
    }

    const controller = new AbortController()
    const activeCatalogs = [...catalogs]
    // Don't blank rows on every keystroke — that visually collapses the list
    // and makes cmdk re-anchor selection to the top (the "jumpy" feeling).
    // Keep prior rows visible with a loading flag until fresh results arrive.
    setCatalogGroups((prev) => {
      const prevById = new Map(prev.map((group) => [group.catalog.id, group]))
      return activeCatalogs.map((catalog) => {
        const prior = prevById.get(catalog.id)
        return {
          catalog,
          rows: prior?.rows ?? [],
          loading: true,
        }
      })
    })

    const updateCatalog = (
      catalog: CatalogConfig,
      next: Omit<CatalogSearchGroup, 'catalog'>,
    ) => {
      if (controller.signal.aborted) return
      setCatalogGroups((groups) =>
        groups.map((group) =>
          group.catalog.id === catalog.id ? { catalog, ...next } : group,
        ),
      )
    }

    for (const catalog of activeCatalogs) {
      try {
        const result = catalog.adapter.search({
          query: debouncedCatalogQuery,
          filters: {},
          limit: MAX_RESULTS,
          offset: 0,
          signal: controller.signal,
        })
        void Promise.resolve(result).then(
          (result) => {
            updateCatalog(catalog, {
              rows: result.items.slice(0, MAX_RESULTS),
              loading: false,
            })
          },
          (error) => {
            updateCatalog(catalog, {
              rows: [],
              loading: false,
              error: errorMessage(error),
            })
          },
        )
      } catch (error) {
        updateCatalog(catalog, {
          rows: [],
          loading: false,
          error: errorMessage(error),
        })
      }
    }

    return () => {
      controller.abort()
    }
  }, [catalogs, debouncedCatalogQuery, isCommandMode])

  return catalogGroups
}
