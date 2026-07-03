import { createContext, useContext, type ReactNode } from "react"
import type { BslDashboardSpec } from "../shared"
import type { DashboardQueryResult } from "./dashboardData"

export interface BiDashboardRenderState {
  apiBaseUrl: string
  workspaceId: string | undefined
  spec: BslDashboardSpec
  queryData: Record<string, DashboardQueryResult>
  refreshKey: number
  controllerValues: Record<string, string>
  setControllerValues: (updater: (previous: Record<string, string>) => Record<string, string>) => void
}

const BiDashboardRenderContext = createContext<BiDashboardRenderState | null>(null)

export function BiDashboardRenderProvider({ value, children }: { value: BiDashboardRenderState; children: ReactNode }) {
  return <BiDashboardRenderContext.Provider value={value}>{children}</BiDashboardRenderContext.Provider>
}

export function useBiDashboardRenderContext(): BiDashboardRenderState {
  const context = useContext(BiDashboardRenderContext)
  if (!context) throw new Error("BI dashboard render context is missing")
  return context
}
