"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export interface PluginError {
  kind: "contribution"
  pluginId: string
  contributionKind: "panel" | "catalog-row" | "chat-suggestion"
  contributionId?: string
  error: Error
  componentStack?: string | null
}

export interface PluginErrorContextValue {
  errors: PluginError[]
  reportPluginError: (error: PluginError) => void
}

const PluginErrorContext = createContext<PluginErrorContextValue | null>(null)

export function PluginErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<PluginError[]>([])

  const reportPluginError = useCallback((error: PluginError) => {
    setErrors((prev) => [...prev, error])
  }, [])

  const value = useMemo<PluginErrorContextValue>(
    () => ({ errors, reportPluginError }),
    [errors, reportPluginError],
  )

  return (
    <PluginErrorContext.Provider value={value}>
      {children}
    </PluginErrorContext.Provider>
  )
}

export function usePluginErrors(): PluginErrorContextValue {
  const ctx = useContext(PluginErrorContext)
  if (!ctx) throw new Error("usePluginErrors must be used within a PluginErrorProvider")
  return ctx
}

export { PluginErrorContext }
