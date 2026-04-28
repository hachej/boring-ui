"use client"

import { useSyncExternalStore } from "react"
import type { PanelConfig } from "../registry/types"
import { useRegistry } from "../registry/RegistryProvider"

export function useActivePanels(): readonly PanelConfig[] {
  const reg = useRegistry()
  return useSyncExternalStore(reg.subscribe, reg.getSnapshot)
}
