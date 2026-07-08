import { afterEach, describe, expect, test, vi } from 'vitest'

import { RemoteWorkerClient, constantTimeTokenEqual } from '../workerClient'
import {
  WORKER_INTERNAL_TOKEN_HEADER,
  WORKER_WORKSPACE_ID_HEADER,
  type RemoteWorkerExecResponse,
} from '../../../shared/remoteWorkerProtocol'

const ERROR_CODE_AUTH_INVALID = 'auth_invalid'

describe('RemoteWorkerClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('builds internal headers from scratch and sends workspace ops', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://worker.internal/internal/workspaces/ws-1/fs')
      const headers = init?.headers as Headers
      expect(headers.get(WORKER_INTERNAL_TOKEN_HEADER)).toBe('secret')
      expect(headers.get(WORKER_WORKSPACE_ID_HEADER)).toBe('ws-1')
      expect(headers.get('authorization')).toBeNull()
      expect(init?.body).toBe(JSON.stringify({ op: 'readFile', path: 'README.md' }))
      return Response.json({ content: 'ok' })
    })

    const client = new RemoteWorkerClient({
      baseUrl: 'http://worker.internal/',
      token: 'secret',
      workspaceId: 'ws-1',
      fetchImpl: fetchImpl as typeof fetch,
    })

    await expect(client.workspace({ op: 'readFile', path: 'README.md' })).resolves.toEqual({ content: 'ok' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  test('decodes exec stdout and stderr from base64', async () => {
    const response: RemoteWorkerExecResponse = {
      stdoutBase64: Buffer.from('hello').toString('base64'),
      stderrBase64: Buffer.from('warn').toString('base64'),
      exitCode: 0,
      durationMs: 12,
      truncated: false,
      stdoutEncoding: 'utf-8',
      stderrEncoding: 'utf-8',
    }
    const fetchImpl = vi.fn(async () => Response.json(response))
    const client = new RemoteWorkerClient({ baseUrl: 'http://worker', token: 'secret', workspaceId: 'ws-1', fetchImpl: fetchImpl as typeof fetch })

    const result = await client.exec({ cmd: 'echo hello' })

    expect(Buffer.from(result.stdout).toString('utf8')).toBe('hello')
    expect(Buffer.from(result.stderr).toString('utf8')).toBe('warn')
    expect(result.exitCode).toBe(0)
  })

  test('rejects remote errors with stable code', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      error: { code: ERROR_CODE_AUTH_INVALID, message: 'invalid internal token', statusCode: 401 },
    }, { status: 401 }))
    const client = new RemoteWorkerClient({ baseUrl: 'http://worker', token: 'secret', workspaceId: 'ws-1', fetchImpl: fetchImpl as typeof fetch })

    await expect(client.health()).rejects.toMatchObject({
      code: ERROR_CODE_AUTH_INVALID,
      statusCode: 401,
    })
  })

  test('times out stalled workspace requests with a stable retryable error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const client = new RemoteWorkerClient({
      baseUrl: 'http://worker',
      token: 'secret',
      workspaceId: 'ws-1',
      fetchImpl: fetchImpl as typeof fetch,
      requestTimeoutMs: 25,
    })

    const pending = expect(client.workspace({ op: 'readFile', path: 'README.md' })).rejects.toMatchObject({
      code: 'REMOTE_WORKER_TIMEOUT',
      statusCode: 504,
      details: { timeoutMs: 25, retryable: true },
    })
    await vi.advanceTimersByTimeAsync(25)
    await pending
  })
})

describe('constantTimeTokenEqual', () => {
  test('fails closed for empty, missing, mismatched, and length-mismatched tokens', () => {
    expect(constantTimeTokenEqual('', 'secret')).toBe(false)
    expect(constantTimeTokenEqual('secret', '')).toBe(false)
    expect(constantTimeTokenEqual('secret', 'other')).toBe(false)
    expect(constantTimeTokenEqual('secret', 'secret!')).toBe(false)
    expect(constantTimeTokenEqual('secret', 'secret')).toBe(true)
  })
})
