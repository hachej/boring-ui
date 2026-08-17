import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentResourceUrl, withStorageScope } from '../agentHttp'
import {
  parseModelSelection,
  type AvailableModel,
  type ModelSelection,
} from '../chatPanelSettings'
import type { ActiveSessionStorageLike } from '../chat/session/sessionSelectionStorage'
import {
  readPiComposerSettings,
  writePiComposerModelSelection,
} from '../chat/session/composerPolicy'

interface SessionModelSelection {
  sessionId?: string
  storage?: ActiveSessionStorageLike
  storageScope?: string
  localDefault: ModelSelection | null
  pendingOverride?: ModelSelection
}

function sameModel(left: ModelSelection | null | undefined, right: ModelSelection | null | undefined): boolean {
  return left?.provider === right?.provider && left?.id === right?.id
}

function availableModel(models: AvailableModel[], model: ModelSelection | null | undefined): boolean {
  return Boolean(model && models.some((candidate) => (
    candidate.available && candidate.provider === model.provider && candidate.id === model.id
  )))
}

export function useChatModelSelection({
  agentTypeId,
  apiBaseUrl,
  defaultModel,
  sessionId,
  sessionHydrated = sessionId === undefined,
  sessionIsNew = sessionId === undefined,
  sessionModel,
  fetch: fetchImpl,
  requestHeaders,
  storage,
  storageScope,
  enabled = true,
}: {
  agentTypeId: string
  apiBaseUrl?: string
  defaultModel?: ModelSelection
  sessionId?: string
  sessionHydrated?: boolean
  sessionIsNew?: boolean
  sessionModel?: ModelSelection
  fetch?: typeof globalThis.fetch
  requestHeaders?: Record<string, string>
  storage?: ActiveSessionStorageLike
  storageScope?: string
  enabled?: boolean
}) {
  const initialSettings = useMemo(() => readPiComposerSettings({ storageScope, storage }), [])
  const [selection, setSelection] = useState<SessionModelSelection>(() => ({
    sessionId,
    storage,
    storageScope,
    localDefault: initialSettings.model ?? defaultModel ?? null,
  }))

  useEffect(() => {
    const settings = readPiComposerSettings({ storageScope, storage })
    setSelection((current) => {
      const sameSession = current.sessionId === sessionId
      const pendingOverride = sameSession
        && current.pendingOverride
        && sessionModel
        && !sameModel(current.pendingOverride, sessionModel)
        ? current.pendingOverride
        : sessionIsNew && sessionModel && settings.model && !sameModel(settings.model, sessionModel)
          ? settings.model
          : undefined
      return {
        sessionId,
        storage,
        storageScope,
        localDefault: settings.model ?? defaultModel ?? null,
        ...(pendingOverride ? { pendingOverride } : {}),
      }
    })
  }, [defaultModel, sessionId, sessionIsNew, sessionModel?.id, sessionModel?.provider, storage, storageScope])

  const setModel = useCallback((next: ModelSelection | null) => {
    const normalized = next === null ? null : parseModelSelection(next)
    setSelection((current) => {
      if (sessionModel) {
        const pendingOverride = normalized && !sameModel(normalized, sessionModel) ? normalized : undefined
        return { ...current, sessionId, ...(pendingOverride ? { pendingOverride } : { pendingOverride: undefined }) }
      }
      if (sessionId && !sessionIsNew) return current
      return { ...current, sessionId, localDefault: normalized, pendingOverride: undefined }
    })
    writePiComposerModelSelection(normalized, { storageScope, storage })
  }, [sessionId, sessionIsNew, sessionModel, storage, storageScope])

  const discoveryKey = useMemo(
    () => JSON.stringify({
      apiBaseUrl: apiBaseUrl ?? '',
      agentTypeId,
      headers: Object.entries(requestHeaders ?? {}).sort(([a], [b]) => a.localeCompare(b)),
      storageScope: storageScope ?? '',
    }),
    [apiBaseUrl, requestHeaders, storageScope],
  )
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loaded, setLoaded] = useState(!enabled)
  const [loadedDiscoveryKey, setLoadedDiscoveryKey] = useState<string | null>(enabled ? null : discoveryKey)

  useEffect(() => {
    if (!enabled) {
      setLoaded(true)
      setLoadedDiscoveryKey(discoveryKey)
      return
    }
    let aborted = false
    setLoaded(false)
    const nextFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)
    nextFetch(agentResourceUrl(apiBaseUrl, `/api/v1/agents/${encodeURIComponent(agentTypeId)}/models`), {
      headers: withStorageScope(requestHeaders, storageScope),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { models?: AvailableModel[]; defaultModel?: ModelSelection } | null) => {
        if (aborted) return
        const models = payload?.models
        if (!models) {
          setAvailableModels([])
          setSelection((current) => ({ ...current, pendingOverride: undefined, localDefault: sessionModel ?? null }))
          if (!sessionModel) writePiComposerModelSelection(null, { storageScope, storage })
          setLoadedDiscoveryKey(discoveryKey)
          setLoaded(true)
          return
        }

        setAvailableModels(models)
        setSelection((current) => {
          const selected = current.pendingOverride ?? sessionModel ?? current.localDefault
          if (availableModel(models, selected)) return current
          if (sessionModel) return { ...current, pendingOverride: undefined }
          if (sessionId && !sessionIsNew) return { ...current, pendingOverride: undefined, localDefault: null }
          const firstAvailable = models.find((candidate) => candidate.available)
          return {
            ...current,
            pendingOverride: undefined,
            localDefault: payload.defaultModel
              ?? (firstAvailable ? { provider: firstAvailable.provider, id: firstAvailable.id } : null),
          }
        })
        setLoadedDiscoveryKey(discoveryKey)
        setLoaded(true)
      })
      .catch(() => {
        if (aborted) return
        setAvailableModels([])
        setSelection((current) => ({ ...current, pendingOverride: undefined, localDefault: sessionModel ?? null }))
        if (!sessionModel) writePiComposerModelSelection(null, { storageScope, storage })
        setLoadedDiscoveryKey(discoveryKey)
        setLoaded(true)
      })
    return () => { aborted = true }
  }, [agentTypeId, apiBaseUrl, discoveryKey, enabled, fetchImpl, requestHeaders, sessionId, sessionIsNew, sessionModel, storage, storageScope])

  useEffect(() => {
    const onChange = (event: Event) => {
      const next = parseModelSelection((event as CustomEvent).detail)
      if (next) setModel(next)
    }
    globalThis.addEventListener?.('boring:model-change', onChange)
    return () => globalThis.removeEventListener?.('boring:model-change', onChange)
  }, [setModel])

  const currentDiscoveryLoaded = !enabled || (loaded && loadedDiscoveryKey === discoveryKey)
  const selectionBelongsToSession = selection.sessionId === sessionId
    && selection.storage === storage
    && selection.storageScope === storageScope
  const pendingOverride = selectionBelongsToSession ? selection.pendingOverride : undefined
  const isOverride = Boolean(pendingOverride && sessionModel && !sameModel(pendingOverride, sessionModel))
  const sessionAuthorityReady = !sessionId || (sessionHydrated && (sessionModel !== undefined || sessionIsNew))
  const model = currentDiscoveryLoaded && sessionAuthorityReady
    ? pendingOverride ?? sessionModel ?? selection.localDefault
    : null

  return {
    availableModels: currentDiscoveryLoaded ? availableModels : [],
    loaded: currentDiscoveryLoaded,
    model,
    sessionModel,
    isOverride,
    setModel,
  }
}
