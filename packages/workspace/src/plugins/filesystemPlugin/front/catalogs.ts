import type { CatalogConfig, CatalogRow, CatalogSearchResult } from "../../../shared/plugins/types"
import {
  uiFileResourceKey,
  type UiFileResource,
} from "../../../shared/types/filesystem"
import { toFileSearchGlob } from "./search"
import { FILES_CATALOG_ID } from "../shared/constants"

export interface FilesCatalogClient {
  searchResources(query: string, limit?: number, signal?: AbortSignal): Promise<UiFileResource[]>
}

export interface CreateFilesCatalogOptions {
  client: FilesCatalogClient
  onSelect?: (resource: UiFileResource, row: CatalogRow) => void
}

function rootLabel(filesystem: string): string {
  return filesystem === "user" ? "Workspace" : filesystem
}

function rowFromResource(resource: UiFileResource): CatalogRow {
  const lastSlash = resource.path.lastIndexOf("/")
  return {
    id: uiFileResourceKey(resource),
    title: lastSlash >= 0 ? resource.path.slice(lastSlash + 1) : resource.path,
    subtitle: lastSlash >= 0 ? resource.path.slice(0, lastSlash + 1) : undefined,
    meta: rootLabel(resource.filesystem),
    resource,
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
        const resources = await client.searchResources(toFileSearchGlob(trimmed), limit, signal)
        if (signal?.aborted) return emptyCatalogSearchResult()
        return {
          items: resources.map(rowFromResource),
          total: resources.length,
          hasMore: false,
        }
      },
    },
    onSelect: (row) => {
      if (row.resource) onSelect?.(row.resource, row)
    },
  }
}
