import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  parseModelSelection,
  type AvailableModel,
  type ModelSelection,
} from '../chatPanelSettings'
import type { ActiveSessionStorageLike } from '../chat/session/activeSessionStorage'
import {
  readPiComposerSettings,
  writePiComposerModelSelection,
} from '../chat/session/composerPolicy'

export function useChatModelSelection({
  apiBaseUrl,
  defaultModel,
  fetch: fetchImpl,
  requestHeaders,
  storage,
  storageScope,
  enabled = true,
}: {
  apiBaseUrl?: string
  defaultModel?: ModelSelection
  fetch?: typeof globalThis.fetch
  requestHeaders?: Record<string, string>
  storage?: ActiveSessionStorageLike
  storageScope?: string
  enabled?: boolean
}) {
  const initialModelState = useMemo(() => readPiComposerSettings({ storageScope, storage }), [])
  const [model, setModelState] = useState<ModelSelection | null>(
    () => initialModelState.model ?? defaultModel ?? null,
  )
  const [userSelectedModel, setUserSelectedModel] = useState<boolean>(
    () => initialModelState.userSelectedModel,
  )
  const userSelectedModelRef = useRef(userSelectedModel)
  const loadedSettingsSourceRef = useRef({ storage, storageScope })
  useEffect(() => {
    userSelectedModelRef.current = userSelectedModel
  }, [userSelectedModel])

  const setModel = useCallback((next: ModelSelection | null) => {
    userSelectedModelRef.current = next !== null
    setUserSelectedModel(next !== null)
    setModelState(next)
    writePiComposerModelSelection(next, { storageScope, storage })
  }, [storage, storageScope])

  const discoveryKey = useMemo(
    () => JSON.stringify({
      apiBaseUrl: apiBaseUrl ?? '',
      headers: Object.entries(requestHeaders ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      storageScope: storageScope ?? '',
    }),
    [apiBaseUrl, requestHeaders, storageScope],
  )
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loaded, setLoaded] = useState(!enabled)
  const [loadedDiscoveryKey, setLoadedDiscoveryKey] = useState<string | null>(enabled ? null : discoveryKey)

  useEffect(() => {
    if (loadedSettingsSourceRef.current.storage !== storage || loadedSettingsSourceRef.current.storageScope !== storageScope) return
    if (!userSelectedModel || !model) return
    writePiComposerModelSelection(model, { storageScope, storage })
  }, [model, storage, storageScope, userSelectedModel])

  useEffect(() => {
    const settings = readPiComposerSettings({ storageScope, storage })
    loadedSettingsSourceRef.current = { storage, storageScope }
    userSelectedModelRef.current = settings.userSelectedModel
    setUserSelectedModel(settings.userSelectedModel)
    setModelState(settings.model ?? defaultModel ?? null)
  }, [storage, storageScope])

  useEffect(() => {
    if (userSelectedModelRef.current || !defaultModel) return
    setModelState(defaultModel)
  }, [defaultModel])

  // Fetch the live list from pi's ModelRegistry so the dropdown reflects
  // what the server actually has auth for, not a hardcoded alias set.
  useEffect(() => {
    if (!enabled) {
      setLoaded(true)
      setLoadedDiscoveryKey(discoveryKey)
      return
    }
    let aborted = false
    setLoaded(false)
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    nextFetch(agentResourceUrl(apiBaseUrl, '/api/v1/agent/models'), {
      headers: scopedHeaders(requestHeaders, storageScope),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { models?: AvailableModel[]; defaultModel?: ModelSelection } | null) => {
        if (aborted) return
        if (!payload?.models) {
          userSelectedModelRef.current = false
          setUserSelectedModel(false)
          setAvailableModels([])
          setModelState(null)
          writePiComposerModelSelection(null, { storageScope, storage })
          setLoadedDiscoveryKey(discoveryKey)
          setLoaded(true)
          return
        }
        setAvailableModels(payload.models)
        setLoadedDiscoveryKey(discoveryKey)
        setLoaded(true)
        const available = payload.models.filter((m) => m.available)
        setModelState((current) => {
          const currentAvailable = current
            ? available.some((m) => m.provider === current.provider && m.id === current.id)
            : false
          if (currentAvailable) return current

          userSelectedModelRef.current = false
          setUserSelectedModel(false)
          writePiComposerModelSelection(null, { storageScope, storage })

          if (payload.defaultModel) return { provider: payload.defaultModel.provider, id: payload.defaultModel.id }
          const firstAvailable = available[0]
          return firstAvailable ? { provider: firstAvailable.provider, id: firstAvailable.id } : null
        })
      })
      .catch(() => {
        if (aborted) return
        userSelectedModelRef.current = false
        setUserSelectedModel(false)
        setAvailableModels([])
        setModelState(null)
        writePiComposerModelSelection(null, { storageScope, storage })
        setLoadedDiscoveryKey(discoveryKey)
        setLoaded(true)
      })
    return () => { aborted = true }
  }, [apiBaseUrl, discoveryKey, enabled, fetchImpl, requestHeaders, storage, storageScope])

  // Optional integration hook for host slash commands. Accepts explicit
  // provider-qualified selections only ({ provider, id } or "provider:id");
  // unqualified legacy aliases are intentionally ignored so Boring never
  // guesses a model provider on Pi's behalf.
  useEffect(() => {
    const onChange = (event: Event) => {
      const next = parseModelSelection((event as CustomEvent).detail)
      if (next) setModel(next)
    }
    globalThis.addEventListener?.('boring:model-change', onChange)
    return () => globalThis.removeEventListener?.('boring:model-change', onChange)
  }, [setModel])

  const currentDiscoveryLoaded = !enabled || (loaded && loadedDiscoveryKey === discoveryKey)
  const currentAvailableModels = currentDiscoveryLoaded ? availableModels : []
  const currentModel = currentDiscoveryLoaded ? model : null

  return { availableModels: currentAvailableModels, loaded: currentDiscoveryLoaded, model: currentModel, setModel }
}

function agentResourceUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = apiBaseUrl?.replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

function scopedHeaders(headers: Record<string, string> | undefined, storageScope: string | undefined): Record<string, string> | undefined {
  if (!headers && !storageScope) return undefined
  const result: Record<string, string> = { ...(headers ?? {}) }
  const hasStorageScope = Object.keys(result).some((key) => key.toLowerCase() === 'x-boring-storage-scope')
  if (storageScope && !hasStorageScope) result['x-boring-storage-scope'] = storageScope
  return result
}
