import { expect, test, vi } from 'vitest'

import { remoteWorkerRuntimeDescriptor } from '../runtimeDescriptor'

test('legacy remote-worker resolution preserves the existing host protocol and pair roots', async () => {
  const fetchImpl = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    expect(String(input)).toBe('http://worker/internal/health')
    return new Response(null, { status: 200 })
  })
  const provider = await remoteWorkerRuntimeDescriptor.createPairFactory({
    providerOptions: {
      baseUrl: 'http://worker/',
      token: 'secret',
      fetchImpl: fetchImpl as typeof fetch,
    },
  })
  const pair = await provider.create({
    workspaceRoot: '/host/workspace',
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    requestId: 'request-1',
  })

  expect(provider.providerId).toBe('remote-worker')
  expect(pair.workspace.root).toBe('/workspace')
  expect(pair.workspace.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(pair.sandbox.provider).toBe('remote-worker')
  expect(pair.sandbox.runtimeContext.runtimeCwd).toBe('/workspace')
  expect(fetchImpl).toHaveBeenCalledOnce()
  const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers
  expect(headers.get('x-boring-internal-token')).toBe('secret')
  expect(headers.get('x-boring-workspace-id')).toBe('workspace-1')
  expect(headers.get('x-boring-request-id')).toBe('request-1')
  await pair.dispose()
})

test('legacy timeout-only options do not silently select the secure fleet provider', async () => {
  const provider = await remoteWorkerRuntimeDescriptor.createPairFactory({
    providerOptions: { requestTimeoutMs: 1_000 },
  })

  expect(provider.providerId).toBe('remote-worker')
  expect(provider.resolveRuntimeRoot({
    workspaceRoot: '/host/workspace',
    sessionId: 'session-1',
  })).toBe('/workspace')
})

test('fleet options select the secure provider path', async () => {
  await expect(remoteWorkerRuntimeDescriptor.createPairFactory({
    providerOptions: { fleet: {} },
  })).rejects.toThrow()
})
