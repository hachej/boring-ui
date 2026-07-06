import { mkdirSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { posix as pathPosix, resolve } from 'node:path'
import type { FastifyRequest } from 'fastify'
import {
  MANAGED_AGENT_MCP_INLINE_ARTIFACT_CONTENT_MAX_CHARS,
  ManagedAgentMcpError,
  createAgentRuntimeBridge,
  createManagedAgentMcpHttpHandler,
  createNodeWorkspace,
  type AgentMeteringSink,
  type ManagedAgentArtifactRef,
  type ManagedAgentCollectArtifactsInput,
  type ManagedAgentMcpDelegateOptions,
} from '@hachej/boring-agent/server'
import { ErrorCode, type Agent, type AgentTool, type SessionCtx, type Workspace } from '@hachej/boring-agent/shared'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'

export const FULL_APP_MCP_MANAGED_AGENT_ENDPOINT = '/mcp/managed-agent'
export const FULL_APP_MCP_MANAGED_AGENT_ARTIFACT_ROOT = 'artifacts/mcp-managed-agent'
export const FULL_APP_MCP_MANAGED_AGENT_NAME = 'Engagement Analyst'
export const FULL_APP_MCP_MANAGED_AGENT_RUNTIME_CWD = '/workspace'

const ENABLED_VALUE = '1'
const DEFAULT_SESSION_ROOT_DIR = 'mcp-managed-agent'
export const FULL_APP_MCP_MANAGED_AGENT_SECRET_CANARY = 'FULL_APP_M1_MCP_SECRET_CANARY'

export interface FullAppMcpManagedAgentConfig {
  enabled: boolean
  endpointPath: string
  workspaceId?: string
  userId?: string
  workspaceRootBase: string
  sessionRoot: string
  bearerToken?: string
  inlineArtifactContentMaxChars: number
}

export interface FullAppMcpManagedAgentComposition {
  agent: Agent
  collectArtifacts(input: ManagedAgentCollectArtifactsInput): Promise<ManagedAgentArtifactRef[]>
}

export interface RegisterFullAppMcpManagedAgentRoutesOptions {
  env?: NodeJS.ProcessEnv
  metering?: AgentMeteringSink
  composition?: FullAppMcpManagedAgentComposition
}

export function readFullAppMcpManagedAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): FullAppMcpManagedAgentConfig {
  const workspaceRootBase = normalizePath(env.BORING_AGENT_WORKSPACE_ROOT) ?? process.cwd()
  const sessionRootBase = normalizePath(env.BORING_AGENT_SESSION_ROOT)
    ?? resolve(workspaceRootBase, '..', 'pi-sessions')
  return {
    enabled: env.BORING_M1_MCP_MANAGED_AGENT_ENABLED === ENABLED_VALUE,
    endpointPath: normalizeEndpointPath(env.BORING_M1_MCP_ENDPOINT_PATH),
    workspaceId: normalizeString(env.BORING_M1_MCP_WORKSPACE_ID),
    userId: normalizeString(env.BORING_M1_MCP_USER_ID),
    workspaceRootBase,
    sessionRoot: resolve(sessionRootBase, DEFAULT_SESSION_ROOT_DIR),
    bearerToken: normalizeString(env.BORING_M1_MCP_BEARER_TOKEN),
    inlineArtifactContentMaxChars: MANAGED_AGENT_MCP_INLINE_ARTIFACT_CONTENT_MAX_CHARS,
  }
}

export function createFullAppMcpManagedAgentComposition(
  config: FullAppMcpManagedAgentConfig,
  options: { metering?: AgentMeteringSink } = {},
): FullAppMcpManagedAgentComposition {
  const workspaceId = requireConfiguredWorkspaceId(config)
  const workspaceHostRoot = resolve(config.workspaceRootBase, workspaceId)
  mkdirSync(workspaceHostRoot, { recursive: true })
  const workspace = createNodeWorkspace(workspaceHostRoot, { runtimeContext: { runtimeCwd: FULL_APP_MCP_MANAGED_AGENT_RUNTIME_CWD } })
  const artifacts = new FullAppMcpManagedAgentArtifacts(workspace)
  const bridge = createAgentRuntimeBridge({
    runtime: 'none',
    workdir: workspaceHostRoot,
    tools: [artifacts.createPublishTool()],
    systemPromptAppend: FULL_APP_MCP_MANAGED_AGENT_SYSTEM_PROMPT,
    sessionStorageRoot: config.sessionRoot,
    metering: options.metering,
  }, {
    harness: { runtimeCwd: FULL_APP_MCP_MANAGED_AGENT_RUNTIME_CWD },
    service: { workdir: FULL_APP_MCP_MANAGED_AGENT_RUNTIME_CWD, workspace },
  })
  return {
    agent: bridge.agent,
    collectArtifacts: (input) => artifacts.collect(input),
  }
}

export function registerFullAppMcpManagedAgentRoutes(
  app: CoreWorkspaceAgentServer,
  options: RegisterFullAppMcpManagedAgentRoutesOptions = {},
): void {
  const env = options.env ?? process.env
  const config = readFullAppMcpManagedAgentConfig(env)
  if (!config.enabled) return
  assertEnabledConfig(config, env, options.metering)

  const composition = options.composition ?? createFullAppMcpManagedAgentComposition(config, { metering: options.metering })
  const handler = createManagedAgentMcpHttpHandler({
    name: 'full-app-engagement-analyst',
    version: '0.0.0',
    agent: composition.agent,
    resolveSessionCtx: () => resolveConfiguredSessionCtx(app, config),
    resolveActor: () => ({
      id: config.userId ?? 'full-app-mcp-managed-agent',
      name: FULL_APP_MCP_MANAGED_AGENT_NAME,
    }),
    collectArtifacts: composition.collectArtifacts,
    maxInlineArtifactContentChars: config.inlineArtifactContentMaxChars,
    redactionCanaries: [
      FULL_APP_MCP_MANAGED_AGENT_SECRET_CANARY,
      config.bearerToken,
      resolve(config.workspaceRootBase, requireConfiguredWorkspaceId(config)),
      config.workspaceRootBase,
      config.sessionRoot,
      process.cwd(),
    ].filter(isSensitiveCanary),
  } satisfies ManagedAgentMcpDelegateOptions & { name: string; version: string })

  app.addHook('onClose', async () => {
    await composition.agent.dispose()
  })

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: config.endpointPath,
    handler: async (request, reply) => {
      if (!isAuthorizedMcpRequest(request, config)) {
        reply.status(401)
        return { error: 'unauthorized' }
      }
      reply.hijack()
      try {
        await handler(request.raw, reply.raw, request.body)
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' })
          reply.raw.end(JSON.stringify({ error: 'managed agent MCP request failed' }))
        } else if (!reply.raw.writableEnded) {
          reply.raw.end()
        }
      }
    },
  })
}

async function resolveConfiguredSessionCtx(
  app: CoreWorkspaceAgentServer,
  config: FullAppMcpManagedAgentConfig,
): Promise<SessionCtx> {
  const workspaceId = requireConfiguredWorkspaceId(config)
  const workspace = await app.workspaceStore.get(workspaceId)
  if (!workspace || workspace.appId !== app.config.appId) {
    throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP managed agent workspace is not configured for this app')
  }
  if (config.userId) {
    const role = await app.workspaceStore.getMemberRole(workspaceId, config.userId)
    if (!role) {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'MCP managed agent user is not a workspace member')
    }
  }
  return { workspaceId, userId: config.userId }
}

class FullAppMcpManagedAgentArtifacts {
  private readonly bySession = new Map<string, Array<{ path: string; title?: string }>>()

  constructor(private readonly workspace: Workspace) {}

  createPublishTool(): AgentTool {
    return {
      name: 'publish_mcp_delivery_markdown',
      description: 'Publish the final delegated brief result as a Markdown artifact for MCP delivery.',
      promptSnippet: 'Use publish_mcp_delivery_markdown once when the final answer is ready. Provide Markdown content for the artifact.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short artifact title.' },
          filename: { type: 'string', description: 'Optional Markdown filename. The host stores it under the managed-agent artifact directory.' },
          content: { type: 'string', description: 'Complete Markdown artifact content.' },
        },
        required: ['content'],
        additionalProperties: false,
      },
      execute: async (params, ctx) => {
        const sessionId = normalizeString(ctx.sessionId)
        if (!sessionId) return toolError('session id is unavailable')
        const content = normalizeString(params.content)
        if (!content) return toolError('content is required')
        const title = normalizeString(params.title) ?? 'Delegated brief result'
        const path = artifactPath(sessionId, normalizeString(params.filename) ?? title)
        await this.writeMarkdown(path, content)
        const records = this.bySession.get(sessionId) ?? []
        records.push({ path, title })
        this.bySession.set(sessionId, records)
        return {
          content: [{ type: 'text', text: `Published Markdown artifact: ${path}` }],
          details: { fileChanges: [{ op: 'write', path }], artifact: { path, mediaType: 'text/markdown', title } },
        }
      },
    }
  }

  async collect(input: ManagedAgentCollectArtifactsInput): Promise<ManagedAgentArtifactRef[]> {
    const records = [...(this.bySession.get(input.sessionId) ?? [])]
    this.bySession.delete(input.sessionId)
    if (records.length === 0) {
      const path = artifactPath(input.sessionId, `${input.delegationId}.md`)
      await this.writeMarkdown(path, input.finalAssistantText || '# Delegated result\n\nNo final assistant text was returned.')
      records.push({ path, title: 'Delegated brief result' })
    }

    const refs: ManagedAgentArtifactRef[] = []
    const seen = new Set<string>()
    for (const record of records) {
      if (seen.has(record.path)) continue
      seen.add(record.path)
      refs.push({
        path: record.path,
        mediaType: 'text/markdown',
        title: record.title,
        content: await this.workspace.readFile(record.path),
      })
    }
    return refs
  }

  private async writeMarkdown(path: string, content: string): Promise<void> {
    const dir = pathPosix.dirname(path)
    if (dir && dir !== '.') await this.workspace.mkdir(dir, { recursive: true })
    await this.workspace.writeFile(path, content.endsWith('\n') ? content : `${content}\n`)
  }
}

const FULL_APP_MCP_MANAGED_AGENT_SYSTEM_PROMPT = [
  'You are the Engagement Analyst demo agent for boring-ui full-app.',
  'Answer delegated outreach/research briefs with concise, executive-ready Markdown.',
  'Use the publish_mcp_delivery_markdown tool once to publish the final Markdown artifact before your final response.',
  'Do not mention host paths, session storage, credentials, tokens, or internal implementation details.',
].join('\n')

function artifactPath(sessionId: string, filename: string): string {
  return `${FULL_APP_MCP_MANAGED_AGENT_ARTIFACT_ROOT}/${safeSegment(sessionId)}/${safeMarkdownFilename(filename)}`
}

function safeMarkdownFilename(value: string): string {
  const basename = pathPosix.basename(value.replace(/\\/g, '/')).replace(/\.md$/i, '')
  const safe = safeSegment(basename) || 'artifact'
  return `${safe}.md`
}

function safeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'artifact'
}

function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

function requireConfiguredWorkspaceId(config: FullAppMcpManagedAgentConfig): string {
  if (!config.workspaceId) {
    throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'BORING_M1_MCP_WORKSPACE_ID is required')
  }
  return config.workspaceId
}

function assertEnabledConfig(config: FullAppMcpManagedAgentConfig, env: NodeJS.ProcessEnv, metering: AgentMeteringSink | undefined): void {
  requireConfiguredWorkspaceId(config)
  if (metering && !config.userId) {
    throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'BORING_M1_MCP_USER_ID is required when managed-agent metering is enabled')
  }
  if (!config.bearerToken) {
    throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'BORING_M1_MCP_BEARER_TOKEN is required when the managed-agent MCP endpoint is enabled')
  }
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isSensitiveCanary(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 1
}

function normalizePath(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  return normalized ? resolve(normalized) : undefined
}

function normalizeEndpointPath(value: unknown): string {
  const path = normalizeString(value) ?? FULL_APP_MCP_MANAGED_AGENT_ENDPOINT
  return path.startsWith('/') ? path : `/${path}`
}

function isAuthorizedMcpRequest(request: FastifyRequest, config: FullAppMcpManagedAgentConfig): boolean {
  if (!config.bearerToken) return false
  const value = request.headers.authorization
  const authorization = Array.isArray(value) ? value[0] : value
  if (typeof authorization !== 'string') return false
  const prefix = 'Bearer '
  if (!authorization.startsWith(prefix)) return false
  return constantTimeEqual(authorization.slice(prefix.length), config.bearerToken)
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
