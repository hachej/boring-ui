import type { ExecOptions, Sandbox } from "../shared/sandbox"
import { safeCapture, type TelemetrySink } from "../shared/telemetry"
import type { RuntimeBundle, RuntimeModeId } from "./runtime/mode"

export interface RuntimeEnvContributionContext {
  workspaceId: string
  workspaceRoot: string
  runtimeMode: RuntimeModeId
  runtimeBundle: RuntimeBundle
}

export interface RuntimeEnvContribution {
  id: string
  getEnv(ctx: RuntimeEnvContributionContext): Record<string, string> | Promise<Record<string, string>>
}

export function withRuntimeEnvContributions(
  runtimeBundle: RuntimeBundle,
  baseContext: RuntimeEnvContributionContext,
  contributions: RuntimeEnvContribution[],
  telemetry?: TelemetrySink,
): RuntimeBundle {
  const getRuntimeEnv = async (): Promise<Record<string, string>> => {
    const contributedEnv: Record<string, string> = {}
    for (const contribution of contributions) {
      Object.assign(contributedEnv, await contribution.getEnv(baseContext))
    }
    if (telemetry) {
      safeCapture(telemetry, {
        name: "agent.runtime.env_contributed",
        properties: {
          runtimeMode: baseContext.runtimeMode,
          contributionIds: contributions.map((contribution) => contribution.id),
        },
      })
    }
    return contributedEnv
  }
  const sandbox: Sandbox = {
    ...runtimeBundle.sandbox,
    exec: async (cmd: string, execOpts: ExecOptions = {}) => {
      const contributedEnv = await getRuntimeEnv()
      return runtimeBundle.sandbox.exec(cmd, {
        ...execOpts,
        env: { ...contributedEnv, ...(execOpts.env ?? {}) },
      })
    },
  }
  return { ...runtimeBundle, sandbox, getRuntimeEnv }
}
