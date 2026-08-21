"use client"

import { ComposerContributionProvider, type ComposerContribution } from "@hachej/boring-agent/front"
import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { PluginProviderProps } from "@hachej/boring-workspace"
import { createAutomationClient, type AutomationClient } from "./client"
import { createScheduleSlashCommand } from "./scheduleCommand"

type AutomationRuntime = { client: AutomationClient; agentTypeId: string; apiBaseUrl: string; authHeaders?: Record<string, string> }

const AutomationClientContext = createContext<AutomationRuntime | null>(null)

export function AutomationRuntimeProvider({ agentTypeId, apiBaseUrl, authHeaders, onAuthError, apiTimeout, workspaceTimezone = "UTC", children }: PluginProviderProps) {
  const client = useMemo(
    () => createAutomationClient({ apiBaseUrl, headers: authHeaders, onAuthError, apiTimeout }),
    [apiBaseUrl, authHeaders, onAuthError, apiTimeout],
  )
  const runtime = useMemo(() => ({ client, agentTypeId, apiBaseUrl, authHeaders }), [agentTypeId, apiBaseUrl, authHeaders, client])
  const composerContribution = useMemo<ComposerContribution>(() => ({
    id: "boring-automation.schedule",
    commands: [createScheduleSlashCommand({ client, workspaceTimezone })],
  }), [client, workspaceTimezone])
  return (
    <AutomationClientContext.Provider value={runtime}>
      <ComposerContributionProvider contribution={composerContribution}>
        {children}
      </ComposerContributionProvider>
    </AutomationClientContext.Provider>
  )
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

export function AutomationClientProvider({ value, children, agentTypeId }: { value: AutomationClient; children: ReactNode; agentTypeId: string }) {
  return <AutomationClientContext.Provider value={{ client: value, agentTypeId, apiBaseUrl: "" }}>{children}</AutomationClientContext.Provider>
}
