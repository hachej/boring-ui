import type { CatalogConfig } from "../../shared/plugins/types"
import type { ExplorerRow, SearchResult } from "../../front/components/DataExplorer/types"
import { toFileSearchGlob } from "./search"
import { FILES_CATALOG_ID } from "./constants"

export interface FilesCatalogClient {
  search(query: string, limit?: number, signal?: AbortSignal): Promise<string[]>
}

export interface CreateFilesCatalogOptions {
  client: FilesCatalogClient
  onSelect?: (path: string, row: ExplorerRow) => void
}

function rowFromPath(path: string): ExplorerRow {
  const lastSlash = path.lastIndexOf("/")
  return {
    id: path,
    title: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
    subtitle: lastSlash >= 0 ? path.slice(0, lastSlash + 1) : undefined,
  }
}

function emptySearchResult(): SearchResult {
  return { items: [], total: 0, hasMore: false }
}

export function createFilesCatalog({
  client,
  onSelect,
}: CreateFilesCatalogOptions): CatalogConfig {
  return {
    id: FILES_CATALOG_ID,
    label: "Files",
    adapter: {
      async search({ query, limit, signal }) {
        const trimmed = query.trim()
        if (!trimmed || signal?.aborted) return emptySearchResult()
        const paths = await client.search(toFileSearchGlob(trimmed), limit, signal)
        if (signal?.aborted) return emptySearchResult()
        return {
          items: paths.map(rowFromPath),
          total: paths.length,
          hasMore: false,
        }
      },
    },
    onSelect: (row) => onSelect?.(row.id, row),
  }
}
