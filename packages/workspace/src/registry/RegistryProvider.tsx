"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { PanelRegistry } from "./PanelRegistry"
import { CommandRegistry } from "./CommandRegistry"

interface RegistryContextValue {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
}

const RegistryContext = createContext<RegistryContextValue | null>(null)

interface RegistryProviderProps {
  panelRegistry: PanelRegistry
  commandRegistry: CommandRegistry
  children: ReactNode
}

export function RegistryProvider({
  panelRegistry,
  commandRegistry,
  children,
}: RegistryProviderProps) {
  const value = useMemo(
    () => ({ panelRegistry, commandRegistry }),
    [panelRegistry, commandRegistry]
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
