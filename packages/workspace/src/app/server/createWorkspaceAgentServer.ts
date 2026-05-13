/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @hachej/boring-agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  autoDetectMode,
  createAgentApp,
  provisionRuntimeWorkspace,
  resolveMode,
  type CreateAgentAppOptions,
} from "@hachej/boring-agent/server"
import type { FastifyInstance } from "fastify"
import { join } from "node:path"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import { createAskUserPluginBundle } from "../../plugins/askUserPlugin/server"
import { ASK_USER_UI_STATE_SLOTS } from "../../plugins/askUserPlugin/shared"
import {
  ServerPluginError,
  bootstrapServer,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
  compactPiPackages,
  type ServerBootstrapOptions,
  type ComposeServerPluginsOptions,
  type WorkspacePiPackageSource,
  type WorkspaceServerPlugin,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"

export interface WorkspaceAgentResourceLoaderOptions {
  noContextFiles?: boolean
  noSkills?: boolean
  additionalSkillPaths?: string[]
  piPackages?: WorkspacePiPackageSource[]
}

type WorkspaceAgentCreateOptions = Omit<
  CreateAgentAppOptions,
  "resourceLoaderOptions"
> & {
  resourceLoaderOptions?: WorkspaceAgentResourceLoaderOptions
}

export interface CreateWorkspaceAgentServerOptions
  extends WorkspaceAgentCreateOptions,
    Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {
  provisionWorkspace?: boolean
  workspaceProvisioning?: { force?: boolean }
  validateUiPaths?: boolean
}

export {
  ServerPluginError,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
}
export type {
  ComposeServerPluginsOptions,
  WorkspacePiPackageSource,
  WorkspaceServerPlugin,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
}

export interface WorkspaceAgentServerPluginCollection {
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
  agentOptions: Pick<
    WorkspaceAgentCreateOptions,
    "extraTools" | "systemPromptAppend" | "resourceLoaderOptions"
  >
}

export interface CollectWorkspaceAgentServerPluginsOptions
  extends Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {
  workspaceRoot?: string
  systemPromptAppend?: string
  resourceLoaderOptions?: WorkspaceAgentResourceLoaderOptions
}

export function buildWorkspaceContextPrompt(): string {
  return [
    '## Workspace',
    '- Root: `$BORING_AGENT_WORKSPACE_ROOT` (exported into every bash invocation)',
    '- Skills: `$BORING_AGENT_WORKSPACE_ROOT/.agents/skills/`',
    '- CLI shims (`bm`, `python`, `pip`): `$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/bin/` — already on PATH, call directly',
  ].join('\n')
}

export function collectWorkspaceAgentServerPlugins(
  opts: CollectWorkspaceAgentServerPluginsOptions = {},
): WorkspaceAgentServerPluginCollection {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const result = bootstrapServer({
    defaults: opts.defaults,
    plugins: opts.plugins,
    excludeDefaults: opts.excludeDefaults,
  })
  const workspaceSkillsDir = join(workspaceRoot, ".agents", "skills")
  const callerAdditional = opts.resourceLoaderOptions?.additionalSkillPaths ?? []
  const callerPiPackages = opts.resourceLoaderOptions?.piPackages ?? []

  return {
    provisioningContributions: result.provisioningContributions,
    routeContributions: result.routeContributions,
    agentOptions: {
      extraTools: result.agentTools,
      systemPromptAppend: [buildBoringSystemPrompt({ workspaceRoot }), opts.systemPromptAppend, result.systemPromptAppend]
        .filter(Boolean)
        .join("\n\n") || undefined,
      resourceLoaderOptions: {
        ...opts.resourceLoaderOptions,
        additionalSkillPaths: [workspaceSkillsDir, ...callerAdditional],
        piPackages: compactPiPackages([...result.piPackages, ...callerPiPackages]),
      },
    },
  }
}

export async function provisionWorkspaceAgentServer(opts: {
  workspaceRoot: string
  provisioningContributions?: WorkspaceProvisioningContribution[]
  force?: boolean
}) {
  if (!opts.provisioningContributions?.length) return

  await provisionRuntimeWorkspace({
    workspaceRoot: opts.workspaceRoot,
    contributions: opts.provisioningContributions,
    force: opts.force,
  })
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const bridge = createInMemoryBridge()
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const workspaceFsCapability = opts.runtimeModeAdapter
    ? opts.runtimeModeAdapter.workspaceFsCapability ?? "best-effort"
    : resolveMode(resolvedMode).workspaceFsCapability ?? "best-effort"
  const validateUiPaths = opts.validateUiPaths ?? workspaceFsCapability === "strong"
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: validateUiPaths ? workspaceRoot : undefined,
  })
  const askUserPlugin = createAskUserPluginBundle({ workspaceRoot, bridge })
  const pluginCollection = collectWorkspaceAgentServerPlugins({
    ...opts,
    plugins: [askUserPlugin, ...(opts.plugins ?? [])],
  })

  if (opts.provisionWorkspace !== false) {
    await provisionWorkspaceAgentServer({
      workspaceRoot,
      provisioningContributions: pluginCollection.provisioningContributions,
      force: opts.workspaceProvisioning?.force,
    })
  }

  const app = await createAgentApp({
    ...opts,
    mode: resolvedMode,
    workspaceRoot,
    extraTools: [
      ...(opts.extraTools ?? []),
      ...uiTools,
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: [
      workspaceFsCapability === "strong" ? buildWorkspaceContextPrompt() : undefined,
      pluginCollection.agentOptions.systemPromptAppend,
    ].filter(Boolean).join("\n\n") || undefined,
    resourceLoaderOptions: pluginCollection.agentOptions.resourceLoaderOptions,
  })
  await app.register(uiRoutes, { bridge, preserveStateKeys: [ASK_USER_UI_STATE_SLOTS.PENDING] })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }
  return app
}
