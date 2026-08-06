import Fastify from 'fastify'
import type { Workspace } from '@hachej/boring-agent/shared'
import { describe, expect, it, vi } from 'vitest'
import { fileRoutes } from './file'

function unavailableWorkspace() {
  return vi.fn(async () => {
    throw new Error('primary workspace must not be resolved')
  }) as () => Promise<Workspace>
}

describe('primary-only file endpoints', () => {
  it('explicitly rejects named filesystems for records instead of reading the primary workspace', async () => {
    const getWorkspace = unavailableWorkspace()
    const app = Fastify()
    await app.register(fileRoutes, { getWorkspace })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/files/records?filesystem=company_context&path=/records.json',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'this endpoint is only available for the primary user filesystem',
        field: 'filesystem',
      },
    })
    expect(getWorkspace).not.toHaveBeenCalled()
    await app.close()
  })

  it('explicitly rejects named filesystems for uploads instead of writing the primary workspace', async () => {
    const getWorkspace = unavailableWorkspace()
    const app = Fastify()
    await app.register(fileRoutes, { getWorkspace })

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files/upload',
      payload: {
        filesystem: 'company_context',
        filename: 'policy.md',
        contentBase64: Buffer.from('policy').toString('base64'),
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'this endpoint is only available for the primary user filesystem',
        field: 'filesystem',
      },
    })
    expect(getWorkspace).not.toHaveBeenCalled()
    await app.close()
  })
})
