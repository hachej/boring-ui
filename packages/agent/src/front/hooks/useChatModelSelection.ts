import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearStoredModelSelection,
  parseModelSelection,
  readStoredModelState,
  writeStoredModelSelection,
  type AvailableModel,
  type ModelSelection,
} from '../chatPanelSettings'

export function useChatModelSelection({
  defaultModel,
  requestHeaders,
  enabled = true,
}: {
  defaultModel?: ModelSelection
  requestHeaders?: Record<string, string>
  enabled?: boolean
}) {
  const initialModelState = useMemo(readStoredModelState, [])
  const [model, setModelState] = useState<ModelSelection | null>(
    () => initialModelState.model ?? defaultModel ?? null,
  )
  const [userSelectedModel, setUserSelectedModel] = useState<boolean>(
    () => initialModelState.userSelected,
  )
  const userSelectedModelRef = useRef(userSelectedModel)
  useEffect(() => {
    userSelectedModelRef.current = userSelectedModel
  }, [userSelectedModel])

  const setModel = useCallback((next: ModelSelection) => {
    setUserSelectedModel(true)
    setModelState(next)
  }, [])

  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])

  useEffect(() => {
    if (!userSelectedModel || !model) return
    writeStoredModelSelection(model)
  }, [model, userSelectedModel])

  useEffect(() => {
    if (userSelectedModelRef.current || !defaultModel) return
    setModelState(defaultModel)
  }, [defaultModel])

  // Fetch the live list from pi's ModelRegistry so the dropdown reflects
  // what the server actually has auth for, not a hardcoded alias set.
  useEffect(() => {
    if (!enabled) return
    let aborted = false
    fetch('/api/v1/agent/models', { headers: requestHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { models?: AvailableModel[]; defaultModel?: ModelSelection } | null) => {
        if (aborted || !payload?.models) return
        setAvailableModels(payload.models)
        const available = payload.models.filter((m) => m.available)
        setModelState((current) => {
          const currentAvailable = current
            ? available.some((m) => m.provider === current.provider && m.id === current.id)
            : false
          if (currentAvailable) return current

          userSelectedModelRef.current = false
          setUserSelectedModel(false)
          clearStoredModelSelection()

          return payload.defaultModel
            ? { provider: payload.defaultModel.provider, id: payload.defaultModel.id }
            : null
        })
      })
      .catch(() => { /* offline — leave list empty, fall back to raw id text */ })
    return () => { aborted = true }
  }, [enabled, requestHeaders])

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

  return { availableModels, model, setModel }
}
