import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentSummary } from '../../shared/gateway/types'
import { gatewayResponseError } from './gatewayResponseError'

export type AddressedAgentOption = Pick<AgentSummary, 'agentTypeId' | 'label' | 'description'>

export interface UseAddressedAgentSelectionOptions {
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  storageScope?: string
  fetch?: typeof globalThis.fetch
  enabled?: boolean
}

export interface UseAddressedAgentSelectionResult {
  agents: AddressedAgentOption[]
  selectedAgentTypeId: string | undefined
  loading: boolean
  error: Error | undefined
  selectAgentTypeId: (agentTypeId: string) => void
}

interface AgentSelectionState {
  discoveryKey: string
  agents: AddressedAgentOption[]
  selectedAgentTypeId: string | undefined
  loading: boolean
  error: Error | undefined
}

const inFlightDiscoveries = new WeakMap<
  typeof globalThis.fetch,
  Map<string, Promise<AddressedAgentOption[]>>
>()

export function useAddressedAgentSelection({
  apiBaseUrl,
  requestHeaders,
  storageScope,
  fetch,
  enabled = false,
}: UseAddressedAgentSelectionOptions = {}): UseAddressedAgentSelectionResult {
  const normalizedBaseUrl = apiBaseUrl?.replace(/\/$/, '') ?? ''
  const headersKey = useMemo(
    () => JSON.stringify({
      storageScope: storageScope ?? '',
      headers: Object.entries(requestHeaders ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    }),
    [requestHeaders, storageScope],
  )
  const discoveryKey = `${normalizedBaseUrl}\n${headersKey}`
  const fetchImpl = fetch ?? globalThis.fetch
  const [state, setState] = useState<AgentSelectionState>(() => ({
    discoveryKey: enabled ? '' : discoveryKey,
    agents: [],
    selectedAgentTypeId: undefined,
    loading: enabled,
    error: undefined,
  }))

  useEffect(() => {
    if (!enabled) {
      setState({
        discoveryKey,
        agents: [],
        selectedAgentTypeId: undefined,
        loading: false,
        error: undefined,
      })
      return
    }

    let cancelled = false
    setState((previous) => ({
      discoveryKey,
      agents: previous.discoveryKey === discoveryKey ? previous.agents : [],
      selectedAgentTypeId: previous.discoveryKey === discoveryKey ? previous.selectedAgentTypeId : undefined,
      loading: true,
      error: undefined,
    }))
    void discoverAgents(fetchImpl, discoveryKey, `${normalizedBaseUrl}/api/v1/agents`, {
      headers: scopedHeaders(requestHeaders, storageScope),
    }).then((agents) => {
      if (cancelled) return
      setState((previous) => ({
        discoveryKey,
        agents,
        selectedAgentTypeId: agents.some((agent) => agent.agentTypeId === previous.selectedAgentTypeId)
          ? previous.selectedAgentTypeId
          : agents[0]?.agentTypeId,
        loading: false,
        error: undefined,
      }))
    }).catch((error) => {
      if (cancelled) return
      setState({
        discoveryKey,
        agents: [],
        selectedAgentTypeId: undefined,
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    })

    return () => {
      cancelled = true
    }
  }, [discoveryKey, enabled, fetchImpl, normalizedBaseUrl])

  const current = state.discoveryKey === discoveryKey
  const agents = enabled && current ? state.agents : []
  const selectedAgentTypeId = enabled && current ? state.selectedAgentTypeId : undefined
  const selectAgentTypeId = useCallback((agentTypeId: string) => {
    setState((previous) => {
      if (previous.discoveryKey !== discoveryKey) return previous
      if (!previous.agents.some((agent) => agent.agentTypeId === agentTypeId)) return previous
      return { ...previous, selectedAgentTypeId: agentTypeId }
    })
  }, [discoveryKey])

  return {
    agents,
    selectedAgentTypeId,
    loading: enabled && (!current || state.loading),
    error: enabled && current ? state.error : undefined,
    selectAgentTypeId,
  }
}

function discoverAgents(
  fetchImpl: typeof globalThis.fetch,
  discoveryKey: string,
  url: string,
  init: RequestInit,
): Promise<AddressedAgentOption[]> {
  let requests = inFlightDiscoveries.get(fetchImpl)
  if (!requests) {
    requests = new Map()
    inFlightDiscoveries.set(fetchImpl, requests)
  }
  const existing = requests.get(discoveryKey)
  if (existing) return existing

  const request = fetchImpl(url, init).then(async (response) => {
    if (!response.ok) throw await gatewayResponseError(response, 'Failed to load agents.', 'load agents')
    return parseAgentOptions(await response.json())
  })
  requests.set(discoveryKey, request)
  void request.finally(() => {
    if (requests?.get(discoveryKey) === request) requests.delete(discoveryKey)
  }).catch(() => undefined)
  return request
}

function parseAgentOptions(value: unknown): AddressedAgentOption[] {
  if (!Array.isArray(value)) throw new Error('Failed to load agents: invalid response')
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error('Failed to load agents: invalid response')
    const record = item as Record<string, unknown>
    if (typeof record.agentTypeId !== 'string' || record.agentTypeId.length === 0) {
      throw new Error('Failed to load agents: invalid response')
    }
    return {
      agentTypeId: record.agentTypeId,
      label: typeof record.label === 'string' && record.label.length > 0 ? record.label : record.agentTypeId,
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
    }
  })
}

function scopedHeaders(
  headers: Record<string, string | undefined> | undefined,
  storageScope: string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[key] = value
  }
  const hasStorageScope = Object.keys(result).some((key) => key.toLowerCase() === 'x-boring-storage-scope')
  if (storageScope && !hasStorageScope) result['x-boring-storage-scope'] = storageScope
  return result
}
