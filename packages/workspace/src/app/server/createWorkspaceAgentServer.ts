/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @boring/agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  createAgentApp,
  provisionRuntimeWorkspace,
  type CreateAgentAppOptions,
} from "@boring/agent/server"
import type { FastifyInstance } from "fastify"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildBoringSystemPrompt } from "../../server/boringSystemPrompt"
import { BoringPluginAssetManager } from "../../server/agentPlugins/manager"
import { boringPluginRoutes } from "../../server/agentPlugins/routes"
import { createBoringPiExtension } from "../../server/agentPlugins/boringPiExtension"
import { pluginRootFromExtensionPath } from "../../server/agentPlugins/scan"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
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
  type WorkspaceExtensionFactory,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"

type HostExtensionFactory = WorkspaceExtensionFactory

export interface WorkspaceAgentResourceLoaderOptions {
  noContextFiles?: boolean
  noSkills?: boolean
  additionalSkillPaths?: string[]
  piPackages?: WorkspacePiPackageSource[]
  additionalExtensionPaths?: string[]
  extensionFactories?: HostExtensionFactory[]
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

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveWorkspacePackageRoot(): string {
  const candidates = [
    join(__dirname, ".."),
    join(__dirname, "../../.."),
  ]
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as { name?: string }
      if (pkg.name === "@boring/workspace") return candidate
    } catch {
      // try next layout
    }
  }
  return join(__dirname, "../../..")
}

function createWorkspacePackageProvisioningContribution(): WorkspaceProvisioningContribution | null {
  const packageRoot = resolveWorkspacePackageRoot()
  if (!existsSync(join(packageRoot, "package.json"))) return null
  return {
    id: "boring-workspace-package",
    provisioning: {
      nodePackages: [
        {
          id: "boring-workspace",
          packageName: "@boring/workspace",
          packageRoot,
        },
      ],
    },
  }
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
  const callerExtensionPaths = opts.resourceLoaderOptions?.additionalExtensionPaths ?? []
  const callerExtensionFactories = opts.resourceLoaderOptions?.extensionFactories ?? []

  return {
    provisioningContributions: [
      createWorkspacePackageProvisioningContribution(),
      ...result.provisioningContributions,
    ].filter((entry): entry is WorkspaceProvisioningContribution => Boolean(entry)),
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
        additionalExtensionPaths: [...result.extensionPaths, ...callerExtensionPaths],
        extensionFactories: [...result.extensionFactories, ...callerExtensionFactories],
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

function collectBoringPluginDirs(workspaceRoot: string, pluginCollection: WorkspaceAgentServerPluginCollection): string[] {
  const extensionPaths = pluginCollection.agentOptions.resourceLoaderOptions?.additionalExtensionPaths ?? []
  const pluginRoots = extensionPaths.flatMap((path) => {
    try {
      return [pluginRootFromExtensionPath(path)]
    } catch {
      return []
    }
  })
  return [
    join(workspaceRoot, ".pi", "extensions"),
    ...pluginRoots,
  ]
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const bridge = createInMemoryBridge()
  const uiTools = createWorkspaceUiTools(bridge, { workspaceRoot })
  const pluginCollection = collectWorkspaceAgentServerPlugins(opts)
  const boringAssetManager = new BoringPluginAssetManager({
    pluginDirs: collectBoringPluginDirs(workspaceRoot, pluginCollection),
    errorRoot: join(workspaceRoot, ".pi", "extensions"),
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
    workspaceRoot,
    extraTools: [
      ...(opts.extraTools ?? []),
      ...uiTools,
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: pluginCollection.agentOptions.systemPromptAppend,
    beforeReload: async () => {
      const result = await boringAssetManager.load()
      if (result.errors.length > 0) {
        const details = result.errors
          .map((error) => `${error.id}#${error.revision}: ${error.message}`)
          .join("\n\n")
        throw new Error(`Boring plugin reload failed:\n\n${details}`)
      }
      await opts.beforeReload?.()
    },
    resourceLoaderOptions: {
      ...pluginCollection.agentOptions.resourceLoaderOptions,
      extensionFactories: [
        createBoringPiExtension({ manager: boringAssetManager }),
        ...(pluginCollection.agentOptions.resourceLoaderOptions?.extensionFactories ?? []),
      ],
    },
  })
  await boringAssetManager.load()
  await app.register(uiRoutes, { bridge })
  await app.register(boringPluginRoutes, { manager: boringAssetManager })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }
  return app
}
