import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'
import { getApiBase } from '../utils.js'

export type AuthClient = ReturnType<typeof createBetterAuthClient>

function createBetterAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    basePath: '/auth',
    plugins: [magicLinkClient()],
  })
}

let singleton: AuthClient | null = null
let singletonBase = ''

export function getAuthClient(baseURL?: string): AuthClient {
  const base = baseURL ?? getApiBase()
  if (singleton && singletonBase === base) return singleton
  singleton = createBetterAuthClient(base)
  singletonBase = base
  return singleton
}
