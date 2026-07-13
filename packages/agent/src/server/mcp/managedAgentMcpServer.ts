import type { IncomingMessage, ServerResponse } from 'node:http'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult, ServerNotification } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import {
  MANAGED_AGENT_MCP_DELIVERY_RULE,
  ManagedAgentMcpDelegateController,
  ManagedAgentMcpError,
  createManagedAgentMcpDelegateController,
  type ManagedAgentDelegateRequestContext,
  type ManagedAgentDelegateResult,
  type ManagedAgentDelegateStatusResult,
  type ManagedAgentMcpDelegateOptions,
} from './managedAgentDelegate'
import { registerShareEntryResources } from './shareEntryResources'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../shared/error-codes'
import type { ShareEntryStore } from '../../shared/share-entry'
import type { SessionCtx } from '../../shared/session'
import type { Workspace } from '../../shared/workspace'

interface ManagedAgentMcpPresentationOptions {
  name?: string
  version?: string
  maxBriefChars?: number
  /**
   * Optional Lane W (AR1-002/AR1-004) share-entry store. When supplied
   * together with `resolveShareSessionCtx`/`resolveShareWorkspace`, the
   * server exposes `listResources`/`readResource` scoped to the
   * authenticated workspace's share entries, on this SAME MCP server
   * process (no second MCP runtime owner). Hosts that omit any of the
   * three leave Lane W unmounted — no widening.
   */
  shareEntryStore?: ShareEntryStore
  /** Resolves the authenticated SessionCtx for a share resource request. */
  resolveShareSessionCtx?: (request: ManagedAgentDelegateRequestContext) => SessionCtx | Promise<SessionCtx>
  /** Resolves the authorized Workspace to read share targets from, for a given SessionCtx. */
  resolveShareWorkspace?: (ctx: SessionCtx) => Workspace | Promise<Workspace>
}

export interface ManagedAgentMcpServerOptions extends ManagedAgentMcpDelegateOptions, ManagedAgentMcpPresentationOptions {}

export type ManagedAgentMcpHttpHandlerOptions =
  | (ManagedAgentMcpPresentationOptions & { controller: ManagedAgentMcpDelegateController })
  | (ManagedAgentMcpServerOptions & { controller?: undefined })

type McpToolExtra = {
  _meta?: {
    progressToken?: string | number
  }
  sessionId?: string
  authInfo?: unknown
  signal?: AbortSignal
  sendNotification(notification: ServerNotification): Promise<void>
}

type ManagedAgentRegisterTool = (
  name: string,
  config: {
    title?: string
    description?: string
    inputSchema?: Record<string, unknown>
  },
  cb: (input: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>,
) => unknown

const DEFAULT_MAX_BRIEF_SCHEMA_CHARS = 32 * 1024

const delegateTaskStatusInputSchema: Record<string, unknown> = {
  delegationId: z.string().min(1),
}

export function createManagedAgentMcpServer(
  options: ManagedAgentMcpServerOptions,
): McpServer {
  return createManagedAgentMcpServerWithController(options, createManagedAgentMcpDelegateController(options))
}

function createManagedAgentMcpServerWithController(
  options: ManagedAgentMcpPresentationOptions,
  controller: ManagedAgentMcpDelegateController,
): McpServer {
  const server = new McpServer({
    name: options.name ?? 'boring-managed-agent',
    version: options.version ?? '0.0.0',
  })

  if (options.shareEntryStore && options.resolveShareSessionCtx && options.resolveShareWorkspace) {
    registerShareEntryResources(server, {
      store: options.shareEntryStore,
      resolveSessionCtx: options.resolveShareSessionCtx,
      resolveWorkspace: options.resolveShareWorkspace,
    })
  }
  const registerTool = server.registerTool.bind(server) as ManagedAgentRegisterTool
  const delegateTaskInputSchema = createDelegateTaskInputSchema(options.maxBriefChars ?? DEFAULT_MAX_BRIEF_SCHEMA_CHARS)

  registerTool(
    'delegate_task',
    {
      title: 'Delegate task',
      description: `${MANAGED_AGENT_MCP_DELIVERY_RULE} Starts one fresh boring-agent session for the supplied brief and streams it to completion.`,
      inputSchema: delegateTaskInputSchema,
    },
    async ({ brief }, extra): Promise<CallToolResult> => {
      try {
        const result = await controller.delegateTask({
          brief: typeof brief === 'string' ? brief : '',
          request: requestContextFromExtra(extra as McpToolExtra | undefined),
          signal: (extra as McpToolExtra | undefined)?.signal,
          onProgress: async (progress) => {
            await sendMcpProgress(extra as McpToolExtra | undefined, progress.eventIndex + 2, progress.message)
          },
        })
        return resultTool(result)
      } catch (error) {
        return errorTool(error)
      }
    },
  )

  registerTool(
    'delegate_task_start',
    {
      title: 'Start delegated task',
      description: `${MANAGED_AGENT_MCP_DELIVERY_RULE} Starts one fresh boring-agent session and immediately returns a delegation id for polling.`,
      inputSchema: delegateTaskInputSchema,
    },
    async ({ brief }, extra): Promise<CallToolResult> => {
      const created = deferred<ManagedAgentDelegateStatusResult>()
      let createdResolved = false
      const completion = controller.delegateTask({
        brief: typeof brief === 'string' ? brief : '',
        request: requestContextFromExtra(extra as McpToolExtra | undefined),
        signal: (extra as McpToolExtra | undefined)?.signal,
        onDelegationCreated: (status) => {
          createdResolved = true
          created.resolve(status)
        },
      })
      void completion.catch((error) => {
        if (!createdResolved) created.reject(error)
      })
      try {
        return resultTool(await created.promise)
      } catch (error) {
        return errorTool(error)
      }
    },
  )

  registerTool(
    'delegate_task_status',
    {
      title: 'Delegate task status',
      description: 'Returns redacted progress and the final M1-pr1 delivery payload for a server-side delegation id.',
      inputSchema: delegateTaskStatusInputSchema,
    },
    async ({ delegationId }, extra): Promise<CallToolResult> => {
      try {
        return resultTool(await controller.getStatusForRequest(
          typeof delegationId === 'string' ? delegationId : '',
          requestContextFromExtra(extra as McpToolExtra | undefined),
        ))
      } catch (error) {
        return errorTool(error)
      }
    },
  )

  return server
}

export function createManagedAgentMcpHttpHandler(options: ManagedAgentMcpHttpHandlerOptions): (
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
) => Promise<void> {
  const controller = options.controller ?? createManagedAgentMcpDelegateController(options)
  return async (req, res, parsedBody) => {
    const server = createManagedAgentMcpServerWithController(options, controller)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: false,
    })
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void server.close().catch(() => undefined)
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, parsedBody)
  }
}

function requestContextFromExtra(extra: McpToolExtra | undefined): ManagedAgentDelegateRequestContext {
  return {
    sessionId: extra?.sessionId,
    authInfo: extra?.authInfo,
  }
}

function createDelegateTaskInputSchema(maxBriefChars: number): Record<string, unknown> {
  return {
    brief: z.string().min(1).max(maxBriefChars),
  }
}

async function sendMcpProgress(extra: McpToolExtra | undefined, progress: number, message: string): Promise<void> {
  const progressToken = extra?._meta?.progressToken
  if (progressToken === undefined) return
  if (typeof extra?.sendNotification !== 'function') return
  await extra.sendNotification({
    method: 'notifications/progress',
    params: { progressToken, progress, message },
  })
}

function resultTool(result: ManagedAgentDelegateResult | ManagedAgentDelegateStatusResult): CallToolResult {
  return {
    structuredContent: result as unknown as Record<string, unknown>,
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function errorTool(error: unknown): CallToolResult {
  const safe = safeError(error)
  return {
    isError: true,
    structuredContent: { error: safe },
    content: [{ type: 'text', text: JSON.stringify({ error: safe }) }],
  }
}

function safeError(error: unknown): { code: StableErrorCode; message: string } {
  if (error instanceof ManagedAgentMcpError) return { code: error.code, message: error.message }
  const parsed = ErrorCode.safeParse((error as { code?: unknown } | undefined)?.code)
  return {
    code: parsed.success ? parsed.data : ErrorCode.enum.INTERNAL_ERROR,
    message: 'MCP delegate tool failed',
  }
}
