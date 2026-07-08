import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import type { VercelSandboxClient } from './resolveSandboxHandle'

export interface VercelAuthConfig {
  token: string
  teamId: string
  projectId?: string
}

export function createDefaultVercelClient(
  auth: VercelAuthConfig,
  opts: { timeoutMs?: number; runtime?: string } = {},
): VercelSandboxClient {
  const credentials = {
    token: auth.token,
    teamId: auth.teamId,
    ...(auth.projectId ? { projectId: auth.projectId } : {}),
  }
  const createOptions = opts.timeoutMs
    ? { ...credentials, timeout: opts.timeoutMs }
    : credentials

  return {
    async create(params) {
      const base = {
        ...createOptions,
        ...(params?.name ? { name: params.name } : {}),
        ...(opts.runtime ? { runtime: opts.runtime } : {}),
        persistent: params?.persistent ?? true,
        snapshotExpiration: params?.snapshotExpiration ?? 0,
      }
      if (params?.source?.type === 'snapshot') {
        const { runtime: _runtime, ...snapshotBase } = base
        return await VercelSandbox.create({
          ...snapshotBase,
          source: { type: 'snapshot', snapshotId: params.source.snapshotId },
        })
      }
      if (params?.source?.type === 'tarball') {
        return await VercelSandbox.create({
          ...base,
          source: { type: 'tarball', url: params.source.url },
        })
      }
      return await VercelSandbox.create(base)
    },
    async get(params) {
      const getParams = {
        ...credentials,
        name: params.name ?? params.sandboxId ?? '',
        resume: params.resume ?? true,
      } as unknown as Parameters<typeof VercelSandbox.get>[0] & { name?: string }
      return await VercelSandbox.get(getParams)
    },
  }
}
