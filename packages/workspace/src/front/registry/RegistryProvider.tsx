"use client"

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { PanelRegistry } from "./PanelRegistry"
import { CommandRegistry } from "./CommandRegistry"
import { SurfaceResolverRegistry } from "./SurfaceResolverRegistry"
import { CatalogRegistry } from "../plugin/CatalogRegistry"

interface RegistryContextValue {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
  catalogRegistry: CatalogRegistry
  surfaceResolverRegistry: SurfaceResolverRegistry
}

const RegistryContext = createContext<RegistryContextValue | null>(null)

interface RegistryProviderProps {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
  catalogRegistry?: CatalogRegistry
  surfaceResolverRegistry?: SurfaceResolverRegistry
  children: ReactNode
}

export function RegistryProvider({
  panelRegistry,
  commandRegistry,
  catalogRegistry,
  surfaceResolverRegistry,
  children,
}: RegistryProviderProps) {
  const fallbackCatalogRegistry = useRef<CatalogRegistry | null>(null)
  const fallbackSurfaceResolverRegistry = useRef<SurfaceResolverRegistry | null>(null)
  if (!fallbackCatalogRegistry.current) {
    fallbackCatalogRegistry.current = new CatalogRegistry()
  }
  if (!fallbackSurfaceResolverRegistry.current) {
    fallbackSurfaceResolverRegistry.current = new SurfaceResolverRegistry()
  }
  const resolvedCatalogRegistry = catalogRegistry ?? fallbackCatalogRegistry.current
  const resolvedSurfaceResolverRegistry = surfaceResolverRegistry ?? fallbackSurfaceResolverRegistry.current
  const value = useMemo(
    () => ({
      panelRegistry,
      commandRegistry,
      catalogRegistry: resolvedCatalogRegistry,
      surfaceResolverRegistry: resolvedSurfaceResolverRegistry,
    }),
    [panelRegistry, commandRegistry, resolvedCatalogRegistry, resolvedSurfaceResolverRegistry],
  )
  return (
    <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>
  )
}

export function useRegistry(): PanelRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error("useRegistry must be used within a RegistryProvider")
  return ctx.panelRegistry
}

export function useCommandRegistry(): CommandRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error("useCommandRegistry must be used within a RegistryProvider")
  return ctx.commandRegistry
}

export function useCatalogRegistry(): CatalogRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error("useCatalogRegistry must be used within a RegistryProvider")
  return ctx.catalogRegistry
}

export function useSurfaceResolverRegistry(): SurfaceResolverRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error("useSurfaceResolverRegistry must be used within a RegistryProvider")
  return ctx.surfaceResolverRegistry
}
