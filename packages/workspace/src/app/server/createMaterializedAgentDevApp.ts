import type {
  AgentHarnessFactory,
  MaterializedAgentSourceV1,
  RuntimeModeAdapter,
  RuntimeModeId,
  WorkspaceAgentDispatcherResolver,
  WorkspaceProvisioningResult,
} from "@hachej/boring-agent/server"
import { ErrorCode } from "@hachej/boring-agent/shared"
import type { FastifyInstance } from "fastify"
import { resolve } from "node:path"
import { createWorkspaceAgentServer, type CreateWorkspaceAgentServerOptions } from "./createWorkspaceAgentServer"

export interface MaterializedAgentDevWorkspaceInput {
  /** Explicit local workspace root. A1 dev-app does not infer or discover workspaces. */
  root: string
  /** Optional stable session/workspace id for the local dev binding. Defaults to source.agentTypeId. */
  sessionId?: string
}

export interface MaterializedAgentDevRuntimePolicy {
  /** Explicit runtime mode. No auto-detect and no direct/sandbox fallback are performed by this seam. */
  mode: RuntimeModeId
  /** Optional already selected adapter for tests or trusted embeddings. */
  runtimeModeAdapter?: RuntimeModeAdapter
  /** Explicitly choose whether the existing workspace runtime provisioning runs. */
  provisionWorkspace: boolean
  /** Optional already prepared runtime provisioning result from the embedding host. */
  runtimeProvisioning?: WorkspaceProvisioningResult
}

export interface MaterializedAgentDevTrustedLocalOptIn {
  /** Re-enable external .pi/~/.pi plugin discovery for a trusted local-only host. Defaults false. */
  externalPlugins?: boolean
  /** Re-enable ambient workspace/global skills for a trusted local-only host. Defaults false. */
  ambientSkills?: boolean
}

export interface CreateMaterializedAgentDevAppOptions {
  /** Already materialized by @hachej/boring-agent/server; this seam never accepts a catalog. */
  source: MaterializedAgentSourceV1
  workspace: MaterializedAgentDevWorkspaceInput
  runtime: MaterializedAgentDevRuntimePolicy
  onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
  /** Test/embedding override for the existing Agent harness. Defaults to the real Pi harness. */
  harnessFactory?: AgentHarnessFactory
  logger?: CreateWorkspaceAgentServerOptions["logger"]
  trustedLocal?: MaterializedAgentDevTrustedLocalOptIn
}

function stableDevAppConfigError(field: string, message: string): Error & { code: string; field: string } {
  return Object.assign(new Error(message), {
    code: ErrorCode.enum.CONFIG_INVALID,
    field,
  })
}

function assertExplicitWorkspaceRoot(root: string): string {
  if (typeof root !== "string") {
    throw stableDevAppConfigError("workspace.root", "materialized agent dev app requires an explicit local workspace root")
  }
  const trimmed = root.trim()
  if (!trimmed) {
    throw stableDevAppConfigError("workspace.root", "materialized agent dev app requires an explicit local workspace root")
  }
  return resolve(trimmed)
}

function assertRuntimePolicy(input: MaterializedAgentDevRuntimePolicy): void {
  if (!input || typeof input !== "object") {
    throw stableDevAppConfigError("runtime", "materialized agent dev app requires an explicit runtime policy")
  }
  if (typeof input.mode !== "string" || input.mode.trim().length === 0) {
    throw stableDevAppConfigError("runtime.mode", "materialized agent dev app requires an explicit runtime mode")
  }
  if (typeof input.provisionWorkspace !== "boolean") {
    throw stableDevAppConfigError("runtime.provisionWorkspace", "materialized agent dev app requires an explicit provisionWorkspace boolean")
  }
  if (input.runtimeModeAdapter && input.runtimeModeAdapter.id !== input.mode) {
    throw stableDevAppConfigError(
      "runtime.runtimeModeAdapter",
      `runtimeModeAdapter id ${input.runtimeModeAdapter.id} does not match explicit mode ${input.mode}`,
    )
  }
}

/**
 * A1.4a local dev-app seam: bind one already-materialized authored source into
 * the existing Workspace+Agent server composer. It deliberately does not compile
 * directories, resolve catalogs, create deployment identities, or introduce a
 * second runtime lifecycle.
 */
export async function createMaterializedAgentDevApp(
  opts: CreateMaterializedAgentDevAppOptions,
): Promise<FastifyInstance> {
  assertRuntimePolicy(opts.runtime)
  const workspaceRoot = assertExplicitWorkspaceRoot(opts.workspace.root)
  const trustedLocal = opts.trustedLocal ?? {}
  const ambientSkills = trustedLocal.ambientSkills === true
  const externalPlugins = trustedLocal.externalPlugins === true

  return await createWorkspaceAgentServer({
    workspaceRoot,
    sessionId: opts.workspace.sessionId ?? opts.source.agentTypeId,
    mode: opts.runtime.mode,
    runtimeModeAdapter: opts.runtime.runtimeModeAdapter,
    provisionWorkspace: opts.runtime.provisionWorkspace,
    runtimeProvisioning: opts.runtime.runtimeProvisioning,
    logger: opts.logger ?? false,
    harnessFactory: opts.harnessFactory,
    onWorkspaceAgentDispatcher: opts.onWorkspaceAgentDispatcher,
    externalPlugins,
    installPluginAuthoring: false,
    includeWorkspaceSkills: ambientSkills,
    pi: {
      noSkills: !ambientSkills,
      noExtensions: !externalPlugins,
      noSystemPromptFiles: true,
    },
    extraTools: [...opts.source.tools],
    systemPromptAppend: opts.source.instructions,
    toolCollisionPolicy: "error",
  })
}
