"use client"

import { useSyncExternalStore } from "react"
import { useCatalogRegistry } from "../registry/RegistryProvider"
import type { CatalogConfig } from "../../shared/plugins/types"

export function useCatalogs(): readonly CatalogConfig[] {
  const registry = useCatalogRegistry()
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot)
}
