"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { PluginProviderProps } from "@hachej/boring-workspace"
import { createAutomationClient, type AutomationClient } from "./client"

type AutomationRuntime = { client: AutomationClient; apiBaseUrl: string; authHeaders?: Record<string, string> }

const AutomationClientContext = createContext<AutomationRuntime | null>(null)

export function AutomationRuntimeProvider({ apiBaseUrl, authHeaders, onAuthError, apiTimeout, children }: PluginProviderProps) {
  const client = useMemo(
    () => createAutomationClient({ apiBaseUrl, headers: authHeaders, onAuthError, apiTimeout }),
    [apiBaseUrl, authHeaders, onAuthError, apiTimeout],
  )
  const runtime = useMemo(() => ({ client, apiBaseUrl, authHeaders }), [apiBaseUrl, authHeaders, client])
  return <AutomationClientContext.Provider value={runtime}>{children}</AutomationClientContext.Provider>
}

export function useAutomationRuntime(): AutomationRuntime {
  const runtime = useContext(AutomationClientContext)
  if (!runtime) throw new Error("useAutomationRuntime must be used within AutomationRuntimeProvider")
  return runtime
}

export function useAutomationClient(): AutomationClient {
  const runtime = useContext(AutomationClientContext)
  if (!runtime) throw new Error("useAutomationClient must be used within AutomationRuntimeProvider")
  return runtime.client
}

export function AutomationClientProvider({ value, children }: { value: AutomationClient; children: ReactNode }) {
  return <AutomationClientContext.Provider value={{ client: value, apiBaseUrl: "" }}>{children}</AutomationClientContext.Provider>
}
