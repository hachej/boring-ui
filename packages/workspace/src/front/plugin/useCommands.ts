"use client"

import { useSyncExternalStore } from "react"
import type { CommandConfig } from "../registry/types"
import { useCommandRegistry } from "../registry/RegistryProvider"

export function useCommands(): readonly CommandConfig[] {
  const reg = useCommandRegistry()
  return useSyncExternalStore(reg.subscribe, reg.getSnapshot)
}
