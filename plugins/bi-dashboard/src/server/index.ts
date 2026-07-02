import { readFile } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
import { defineServerPlugin, type WorkspaceBridgeHandlerContribution, type WorkspaceServerPlugin } from "@hachej/boring-workspace/server"
import { diagnoseDashboardSpec, type DashboardDiagnosticsResult } from "../shared"

export const BI_DASHBOARD_VALIDATE_OP = "bi-dashboard.v1.validate"

export interface BiDashboardValidateInput {
  path?: string
  spec?: unknown
}

export interface CreateBiDashboardServerPluginOptions {
  workspaceRoot: string
}

function resolveWorkspacePath(root: string, inputPath: string): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(resolvedRoot, inputPath)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path is outside workspace: ${inputPath}`)
  return resolvedPath
}

export function createBiDashboardServerPlugin(options: CreateBiDashboardServerPluginOptions): WorkspaceServerPlugin {
  const validateDashboard = {
    definition: {
      op: BI_DASHBOARD_VALIDATE_OP,
      version: 1,
      owner: "bi-dashboard",
      callerClassesAllowed: ["browser", "runtime", "server"],
      requiredCapabilities: ["data:read"],
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          spec: { type: "object" },
        },
      },
      outputSchema: { type: "object" },
      maxInputBytes: 2 * 1024 * 1024,
      maxOutputBytes: 512 * 1024,
      timeoutMs: 10_000,
      idempotencyPolicy: "none" as const,
    },
    handler: async ({ input }: { input: BiDashboardValidateInput }): Promise<DashboardDiagnosticsResult> => {
      let spec = input.spec
      if (spec === undefined) {
        if (!input.path) throw new Error("bi-dashboard validation requires either spec or path")
        const path = resolveWorkspacePath(options.workspaceRoot, input.path)
        spec = JSON.parse(await readFile(path, "utf8"))
      }
      return diagnoseDashboardSpec(spec)
    },
  }

  return defineServerPlugin({
    id: "bi-dashboard",
    label: "BI Dashboard",
    workspaceBridgeHandlers: [validateDashboard as unknown as WorkspaceBridgeHandlerContribution],
    systemPrompt: "Use bi-dashboard.v1.validate through WorkspaceBridge after writing dashboards/*.dashboard.json. Fix diagnostics before presenting the dashboard.",
  })
}

export default function defaultBiDashboardServerPlugin(_options: unknown, ctx: { workspaceRoot: string }): WorkspaceServerPlugin {
  return createBiDashboardServerPlugin({ workspaceRoot: ctx.workspaceRoot })
}
