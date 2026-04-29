"use client"

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react"
import { PanelRegistry } from "./PanelRegistry"
import { CommandRegistry } from "./CommandRegistry"
import { CatalogRegistry } from "../plugin/CatalogRegistry"

interface RegistryContextValue {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
  catalogRegistry: CatalogRegistry
}

const RegistryContext = createContext<RegistryContextValue | null>(null)

interface RegistryProviderProps {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
  catalogRegistry?: CatalogRegistry
  children: ReactNode
}

export function RegistryProvider({
  panelRegistry,
  commandRegistry,
  catalogRegistry,
  children,
}: RegistryProviderProps) {
  const fallbackCatalogRegistry = useRef<CatalogRegistry | null>(null)
  if (!fallbackCatalogRegistry.current) {
    fallbackCatalogRegistry.current = new CatalogRegistry()
  }
  const resolvedCatalogRegistry = catalogRegistry ?? fallbackCatalogRegistry.current
  const value = useMemo(
    () => ({ panelRegistry, commandRegistry, catalogRegistry: resolvedCatalogRegistry }),
    [panelRegistry, commandRegistry, resolvedCatalogRegistry],
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
