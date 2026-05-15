import type { CatalogConfig, CatalogRow, CatalogSearchResult } from "../../../shared/plugins/types"
import { toFileSearchGlob } from "./search"
import { FILES_CATALOG_ID } from "../shared/constants"

export interface FilesCatalogClient {
  search(query: string, limit?: number, signal?: AbortSignal): Promise<string[]>
}

export interface CreateFilesCatalogOptions {
  client: FilesCatalogClient
  onSelect?: (path: string, row: CatalogRow) => void
}

function rowFromPath(path: string): CatalogRow {
  const lastSlash = path.lastIndexOf("/")
  return {
    id: path,
    title: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
    subtitle: lastSlash >= 0 ? path.slice(0, lastSlash + 1) : undefined,
  }
}

function emptyCatalogSearchResult(): CatalogSearchResult {
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
        if (!trimmed || signal?.aborted) return emptyCatalogSearchResult()
        const paths = await client.search(toFileSearchGlob(trimmed), limit, signal)
        if (signal?.aborted) return emptyCatalogSearchResult()
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
