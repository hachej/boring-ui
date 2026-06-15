import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  type RemoteWorkerExecRequest,
  type RemoteWorkerExecResponse,
  type RemoteWorkerWorkspaceOp,
} from '@hachej/boring-agent/server'
import type { ExecResult } from '@hachej/boring-agent/shared'

import type { WorkerConfig } from './config.js'
import { verifyInternalToken } from './auth.js'
import { buildExecEnv, ExecSemaphore } from './exec.js'
import { assertSafeWorkspaceId, createWorkerRuntime, runWorkspaceOp, type WorkerRuntime } from './workspace.js'

interface WorkspaceParams {
  workspaceId: string
}

function errorPayload(error: unknown): { error: { code: string; message: string; statusCode: number; details?: unknown } } {
  const record = error as { code?: unknown; statusCode?: unknown; details?: unknown; message?: unknown }
  const statusCode = typeof record.statusCode === 'number' ? record.statusCode : 500
  return {
    error: {
      code: typeof record.code === 'string' ? record.code : statusCode >= 500 ? 'internal' : 'bad_request',
      message: typeof record.message === 'string' ? record.message : 'worker request failed',
      statusCode,
      ...(record.details === undefined ? {} : { details: record.details }),
    },
  }
}

function sendError(reply: FastifyReply, error: unknown): void {
  const payload = errorPayload(error)
  reply.code(payload.error.statusCode).send(payload)
}

function resultToResponse(result: ExecResult): RemoteWorkerExecResponse {
  return {
    stdoutBase64: Buffer.from(result.stdout).toString('base64'),
    stderrBase64: Buffer.from(result.stderr).toString('base64'),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated,
    stdoutEncoding: result.stdoutEncoding,
    stderrEncoding: result.stderrEncoding,
  }
}

export async function registerWorkerRoutes(app: FastifyInstance, config: WorkerConfig): Promise<void> {
  const semaphore = new ExecSemaphore(config.execConcurrency)
  const runtimes = new Map<string, Promise<WorkerRuntime>>()

  const getRuntime = (workspaceId: string): Promise<WorkerRuntime> => {
    const safeId = assertSafeWorkspaceId(workspaceId)
    let runtime = runtimes.get(safeId)
    if (!runtime) {
      runtime = createWorkerRuntime(config.workspaceRoot, safeId, {
        bwrapNetwork: config.bwrapNetwork,
        resourceLimits: config.resourceLimits,
      })
      runtimes.set(safeId, runtime)
    }
    return runtime
  }

  app.addHook('onClose', async () => {
    for (const runtimePromise of runtimes.values()) {
      try {
        const runtime = await runtimePromise
        runtime.workspace.watch?.().close()
      } catch {
        // Ignore shutdown cleanup failures.
      }
    }
  })

  app.get('/health', async () => ({ ok: true }))
  app.get('/internal/health', async () => ({ ok: true }))

  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' && request.url === '/health') return
    if (!verifyInternalToken(request, reply, config.internalToken)) return reply
  })

  app.post<{ Params: WorkspaceParams; Body: RemoteWorkerWorkspaceOp }>(
    '/internal/workspaces/:workspaceId/fs',
    async (request, reply) => {
      try {
        const runtime = await getRuntime(request.params.workspaceId)
        if (!request.body || typeof request.body.op !== 'string') {
          throw Object.assign(new Error('workspace op is required'), { statusCode: 400, code: 'validation_error' })
        }
        return await runWorkspaceOp(runtime.workspace, request.body)
      } catch (error) {
        sendError(reply, error)
      }
    },
  )

  app.post<{ Params: WorkspaceParams; Body: RemoteWorkerExecRequest }>(
    '/internal/workspaces/:workspaceId/exec',
    async (request, reply) => {
      try {
        const runtime = await getRuntime(request.params.workspaceId)
        const body = request.body
        if (!body || typeof body.cmd !== 'string' || body.cmd.length === 0) {
          throw Object.assign(new Error('cmd is required'), { statusCode: 400, code: 'validation_error' })
        }
        const abortController = new AbortController()
        const abort = () => abortController.abort()
        request.raw.on('aborted', abort)
        reply.raw.on('close', abort)
        const result = await semaphore.run(() => runtime.sandbox.exec(body.cmd, {
          cwd: body.cwd,
          env: buildExecEnv(body.env),
          timeoutMs: body.timeoutMs,
          maxOutputBytes: body.maxOutputBytes,
          signal: abortController.signal,
        }))
        return resultToResponse(result)
      } catch (error) {
        sendError(reply, error)
      }
    },
  )

  app.get<{ Params: WorkspaceParams }>(
    '/internal/workspaces/:workspaceId/fs/events',
    async (request: FastifyRequest<{ Params: WorkspaceParams }>, reply) => {
      let unsubscribe: (() => void) | null = null
      let heartbeat: NodeJS.Timeout | null = null
      try {
        const runtime = await getRuntime(request.params.workspaceId)
        reply.hijack()
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        reply.raw.flushHeaders?.()
        reply.raw.write(': connected\n\n')
        const send = (payload: unknown): void => {
          reply.raw.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`)
        }
        if (!runtime.workspace.watch) {
          throw Object.assign(new Error('workspace events unsupported'), { statusCode: 501, code: 'not_implemented' })
        }
        unsubscribe = runtime.workspace.watch().subscribe((event) => send({ event }))
        heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000)
        const cleanup = (): void => {
          unsubscribe?.()
          unsubscribe = null
          if (heartbeat) clearInterval(heartbeat)
          heartbeat = null
        }
        request.raw.on('close', cleanup)
        reply.raw.on('close', cleanup)
      } catch (error) {
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe?.()
        if (!reply.sent) sendError(reply, error)
      }
    },
  )
}
