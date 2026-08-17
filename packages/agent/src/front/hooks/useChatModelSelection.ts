import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const initialModelState = useMemo(() => readPiComposerSettings({ storageScope, storage }), [])
  const [model, setModelState] = useState<ModelSelection | null>(() => {
    if (sessionId && (!sessionHydrated || (!sessionModel && !sessionIsNew))) return null
    return sessionModel ?? initialModelState.model ?? defaultModel ?? null
  })
  const [selectionSessionId, setSelectionSessionId] = useState(sessionId)
  const [userSelectedModel, setUserSelectedModel] = useState<boolean>(
    () => sessionId === undefined && initialModelState.userSelectedModel,
  )
  const userSelectedModelRef = useRef(userSelectedModel)
  const loadedSettingsSourceRef = useRef({ storage, storageScope })
  useEffect(() => {
    userSelectedModelRef.current = userSelectedModel
  }, [userSelectedModel])

  const setModel = useCallback((next: ModelSelection | null) => {
    const normalized = next === null ? null : parseModelSelection(next)
    const differsFromSession = normalized !== null && sessionModel !== undefined
      && (normalized.provider !== sessionModel.provider || normalized.id !== sessionModel.id)
    const userSelected = sessionModel ? differsFromSession : normalized !== null && (!sessionId || sessionIsNew)
    userSelectedModelRef.current = userSelected
    setUserSelectedModel(userSelected)
    setSelectionSessionId(sessionId)
    setModelState(normalized ?? sessionModel ?? null)
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
    if (loadedSettingsSourceRef.current.storage !== storage || loadedSettingsSourceRef.current.storageScope !== storageScope) return
    if (!userSelectedModel || !model) return
    writePiComposerModelSelection(model, { storageScope, storage })
  }, [model, storage, storageScope, userSelectedModel])

  useEffect(() => {
    const settings = readPiComposerSettings({ storageScope, storage })
    loadedSettingsSourceRef.current = { storage, storageScope }
    setSelectionSessionId(sessionId)
    if (sessionId && (!sessionHydrated || (!sessionModel && !sessionIsNew))) {
      userSelectedModelRef.current = false
      setUserSelectedModel(false)
      setModelState(null)
      return
    }
    if (sessionModel) {
      const currentIsOverride = userSelectedModelRef.current
        && selectionSessionId === sessionId
        && model !== null
        && (model.provider !== sessionModel.provider || model.id !== sessionModel.id)
      if (currentIsOverride) return
      userSelectedModelRef.current = false
      setUserSelectedModel(false)
      setModelState(sessionModel)
      return
    }
    const userSelected = sessionId === undefined && settings.userSelectedModel
    userSelectedModelRef.current = userSelected
    setUserSelectedModel(userSelected)
    setModelState(settings.model ?? defaultModel ?? null)
  }, [defaultModel, sessionHydrated, sessionId, sessionIsNew, sessionModel?.id, sessionModel?.provider, storage, storageScope])

  useEffect(() => {
    if (sessionModel || (sessionId && (!sessionHydrated || !sessionIsNew)) || userSelectedModelRef.current || !defaultModel) return
    setModelState(defaultModel)
  }, [defaultModel, sessionHydrated, sessionId, sessionIsNew, sessionModel])

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
    nextFetch(agentResourceUrl(apiBaseUrl, `/api/v1/agents/${encodeURIComponent(agentTypeId)}/models`), {
      headers: withStorageScope(requestHeaders, storageScope),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { models?: AvailableModel[]; defaultModel?: ModelSelection } | null) => {
        if (aborted) return
        if (!payload?.models) {
          userSelectedModelRef.current = false
          setUserSelectedModel(false)
          setAvailableModels([])
          setModelState(sessionModel ?? null)
          if (!sessionModel) writePiComposerModelSelection(null, { storageScope, storage })
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

          if (sessionModel) return sessionModel
          if (sessionId && !sessionIsNew) return null
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
        setModelState(sessionModel ?? null)
        if (!sessionModel) writePiComposerModelSelection(null, { storageScope, storage })
        setLoadedDiscoveryKey(discoveryKey)
        setLoaded(true)
      })
    return () => { aborted = true }
  }, [agentTypeId, apiBaseUrl, discoveryKey, enabled, fetchImpl, requestHeaders, sessionId, sessionIsNew, sessionModel, storage, storageScope])

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
  const selectionBelongsToSession = selectionSessionId === sessionId
  const isOverride = Boolean(
    selectionBelongsToSession
      && sessionModel
      && model
      && (model.provider !== sessionModel.provider || model.id !== sessionModel.id),
  )
  const currentModel = currentDiscoveryLoaded && (!sessionId || (sessionHydrated && (sessionModel !== undefined || sessionIsNew)))
    ? isOverride ? model : sessionModel ?? model
    : null

  return {
    availableModels: currentAvailableModels,
    loaded: currentDiscoveryLoaded,
    model: currentModel,
    sessionModel,
    isOverride,
    setModel,
  }
}
