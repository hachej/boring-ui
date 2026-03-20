import { buildApiUrl } from '../utils/apiBase'

const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

export function runtimeConfigToProviderConfig(runtimeConfig) {
  const payload = asObject(runtimeConfig)
  const frontend = asObject(payload.frontend)

  return {
    ...frontend,
    app: asObject(payload.app),
    agents: asObject(payload.agents),
    auth: payload.auth ?? null,
    mode: asObject(frontend.mode),
  }
}

export async function fetchRuntimeConfig(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchRuntimeConfig requires a fetch implementation')
  }

  const response = await fetchImpl(buildApiUrl('/__bui/config'), {
    credentials: 'include',
  })
  if (!response.ok) {
    throw new Error(`Failed to load runtime config (${response.status})`)
  }
  return response.json()
}
