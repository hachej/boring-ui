import { z } from "zod"
import { defineServerPlugin, defineTrustedDomainBridgeHandler, type WorkspaceBridgeHandler, type WorkspaceBridgeHandlerContribution, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { diagnoseDashboardSpec, type DashboardDiagnosticsResult } from "../shared"

export const BI_DASHBOARD_VALIDATE_OP = "bi-dashboard.v1.validate"

export interface BiDashboardValidateInput {
  spec?: unknown
}

export interface CreateBiDashboardServerPluginOptions {
  workspaceRoot: string
}

function contribution<TInput, TOutput>(entry: ReturnType<typeof defineTrustedDomainBridgeHandler<TInput, TOutput>>): WorkspaceBridgeHandlerContribution {
  return {
    definition: entry.definition,
    handler: entry.handler as WorkspaceBridgeHandler,
  }
}

function assertValidateInput(input: unknown): asserts input is BiDashboardValidateInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("bi-dashboard validation input must be an object")
  if (!("spec" in input)) throw new Error("bi-dashboard validation requires spec")
}

export function createBiDashboardServerPlugin(_options: CreateBiDashboardServerPluginOptions): WorkspaceServerPlugin {
  const validateDashboard = defineTrustedDomainBridgeHandler<BiDashboardValidateInput, DashboardDiagnosticsResult>({
    op: BI_DASHBOARD_VALIDATE_OP,
    version: 1,
    owner: "bi-dashboard",
    callerClassesAllowed: ["browser", "runtime", "server"],
    requiredCapabilities: ["bi-dashboard:validate"],
    inputSchema: z.object({ spec: z.unknown() }),
    outputSchema: { type: "object" },
    maxInputBytes: 2 * 1024 * 1024,
    maxOutputBytes: 512 * 1024,
    timeoutMs: 10_000,
    idempotencyPolicy: "none",
    handler: async ({ input }) => {
      assertValidateInput(input)
      return diagnoseDashboardSpec(input.spec)
    },
  })

  return defineServerPlugin({
    id: "bi-dashboard",
    label: "BI Dashboard",
    workspaceBridgeHandlers: [contribution(validateDashboard)],
    systemPrompt: "Use bi-dashboard.v1.validate through WorkspaceBridge with { spec } after writing dashboards/*.dashboard.json. Fix diagnostics before presenting the dashboard. Layout rule: compact KPI/indicator-only sections may use 1-5 columns, but any dashboard section containing charts or tables must use at most 2 columns per row.",
  })
}

export default function defaultBiDashboardServerPlugin(_options: unknown, ctx: { workspaceRoot: string }): WorkspaceServerPlugin {
  return createBiDashboardServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}
