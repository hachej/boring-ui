"use client"

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { PanelRegistry } from "./PanelRegistry"
import { WorkspaceSourceRegistry } from "./WorkspaceSourceRegistry"
import { CommandRegistry } from "../../shared/plugins/CommandRegistry"
import { SurfaceResolverRegistry } from "../../shared/plugins/SurfaceResolverRegistry"
import { CatalogRegistry } from "../../shared/plugins/CatalogRegistry"

interface RegistryContextValue {
  panelRegistry: PanelRegistry
  workspaceSourceRegistry: WorkspaceSourceRegistry
  commandRegistry: CommandRegistry
  catalogRegistry: CatalogRegistry
  surfaceResolverRegistry: SurfaceResolverRegistry
}

const RegistryContext = createContext<RegistryContextValue | null>(null)

interface RegistryProviderProps {
  panelRegistry: PanelRegistry
  workspaceSourceRegistry?: WorkspaceSourceRegistry
  commandRegistry: CommandRegistry
  catalogRegistry?: CatalogRegistry
  surfaceResolverRegistry?: SurfaceResolverRegistry
  children: ReactNode
}

export function RegistryProvider({
  panelRegistry,
  workspaceSourceRegistry,
  commandRegistry,
  catalogRegistry,
  surfaceResolverRegistry,
  children,
}: RegistryProviderProps) {
  const fallbackWorkspaceSourceRegistry = useRef<WorkspaceSourceRegistry | null>(null)
  const fallbackCatalogRegistry = useRef<CatalogRegistry | null>(null)
  const fallbackSurfaceResolverRegistry = useRef<SurfaceResolverRegistry | null>(null)
  if (!fallbackWorkspaceSourceRegistry.current) {
    fallbackWorkspaceSourceRegistry.current = new WorkspaceSourceRegistry()
  }
  if (!fallbackCatalogRegistry.current) {
    fallbackCatalogRegistry.current = new CatalogRegistry()
  }
  if (!fallbackSurfaceResolverRegistry.current) {
    fallbackSurfaceResolverRegistry.current = new SurfaceResolverRegistry()
  }
  const resolvedWorkspaceSourceRegistry = workspaceSourceRegistry ?? fallbackWorkspaceSourceRegistry.current
  const resolvedCatalogRegistry = catalogRegistry ?? fallbackCatalogRegistry.current
  const resolvedSurfaceResolverRegistry = surfaceResolverRegistry ?? fallbackSurfaceResolverRegistry.current
  const value = useMemo(
    () => ({
      panelRegistry,
      workspaceSourceRegistry: resolvedWorkspaceSourceRegistry,
      commandRegistry,
      catalogRegistry: resolvedCatalogRegistry,
      surfaceResolverRegistry: resolvedSurfaceResolverRegistry,
    }),
    [panelRegistry, resolvedWorkspaceSourceRegistry, commandRegistry, resolvedCatalogRegistry, resolvedSurfaceResolverRegistry],
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

export function useWorkspaceSourceRegistry(): WorkspaceSourceRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error("useWorkspaceSourceRegistry must be used within a RegistryProvider")
  return ctx.workspaceSourceRegistry
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
