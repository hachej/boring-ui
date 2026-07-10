"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { PluginProviderProps } from "@hachej/boring-workspace"
import { createAutomationClient, type AutomationClient } from "./client"

const AutomationClientContext = createContext<AutomationClient | null>(null)

export function AutomationRuntimeProvider({ apiBaseUrl, authHeaders, onAuthError, apiTimeout, children }: PluginProviderProps) {
  const client = useMemo(
    () => createAutomationClient({ apiBaseUrl, headers: authHeaders, onAuthError, apiTimeout }),
    [apiBaseUrl, authHeaders, onAuthError, apiTimeout],
  )
  return <AutomationClientContext.Provider value={client}>{children}</AutomationClientContext.Provider>
}

export function useAutomationClient(): AutomationClient {
  const client = useContext(AutomationClientContext)
  if (!client) throw new Error("useAutomationClient must be used within AutomationRuntimeProvider")
  return client
}

export function AutomationClientProvider({ value, children }: { value: AutomationClient; children: ReactNode }) {
  return <AutomationClientContext.Provider value={value}>{children}</AutomationClientContext.Provider>
}
