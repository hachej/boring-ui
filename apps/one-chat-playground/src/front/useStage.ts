import { useCallback, useEffect, useReducer, useRef } from 'react'

import {
  initialStageState,
  parseStageEvent,
  stageReducer,
  type MobileChatMode,
  type StageState,
} from '../shared/stage.js'

export const STAGE_STREAM_URL = '/api/one-chat/stage/stream'
export const STAGE_CLEAR_URL = '/api/one-chat/stage/clear'
export const ACTIVITY_CLEAR_URL = '/api/one-chat/activity/clear'

export interface UseStageResult extends StageState {
  /** Dismiss the stage overlay. Goes through the server so every open tab agrees. */
  clearSheet: () => void
  /** Clear a completed sketch/build once the colleague starts speaking. */
  clearActivity: () => void
  markAppReady: () => void
  openChat: () => void
  expandChat: () => void
  hideChat: () => void
  markAssistantMessage: () => void
  setQuestionPending: (pending: boolean) => void
}

/** Subscribes the stage to the server's SSE channel. The reducer stays pure and tested. */
export function useStage(streamUrl: string = STAGE_STREAM_URL): UseStageResult {
  const [state, dispatch] = useReducer(stageReducer, initialStageState)
  const stateRef = useRef(state)
  stateRef.current = state

  const historyMode = (): MobileChatMode | undefined => {
    const value = window.history.state as { oneChatMode?: unknown } | null
    return value?.oneChatMode === 'button' || value?.oneChatMode === 'half' || value?.oneChatMode === 'full'
      ? value.oneChatMode
      : undefined
  }
  const replaceHistory = useCallback((mode: MobileChatMode) => {
    window.history.replaceState({ ...(window.history.state ?? {}), oneChatMode: mode }, '')
  }, [])
  const pushHistory = useCallback((mode: MobileChatMode) => {
    window.history.pushState({ ...(window.history.state ?? {}), oneChatMode: mode }, '')
  }, [])
  const closeHistory = useCallback(() => {
    if (historyMode() === 'half' || historyMode() === 'full') window.history.back()
    else replaceHistory('button')
  }, [replaceHistory])

  useEffect(() => {
    if (!historyMode()) replaceHistory('button')
    const onPopState = (event: PopStateEvent) => {
      const value = event.state as { oneChatMode?: unknown } | null
      const mode = value?.oneChatMode === 'half' || value?.oneChatMode === 'full' ? value.oneChatMode : 'button'
      dispatch({ type: 'chat.history', mode })
      if (mode === 'button' && stateRef.current.mobileChat.questionPending) pushHistory('half')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [pushHistory, replaceHistory])

  useEffect(() => {
    const source = new EventSource(streamUrl)
    source.onmessage = (event) => {
      let payload: unknown
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      const stageEvent = parseStageEvent(payload)
      if (!stageEvent) return
      dispatch(stageEvent)
      if (stageEvent.type === 'stage.show' && !stateRef.current.mobileChat.questionPending) closeHistory()
    }
    return () => source.close()
  }, [closeHistory, streamUrl])

  const clearSheet = useCallback(() => {
    // Optimistic: the SSE echo is idempotent, and the button must feel instant.
    dispatch({ type: 'stage.clear' })
    void fetch(STAGE_CLEAR_URL, { method: 'POST' }).catch(() => {})
  }, [])

  const clearActivity = useCallback(() => {
    dispatch({ type: 'activity.clear' })
    void fetch(ACTIVITY_CLEAR_URL, { method: 'POST' }).catch(() => {})
  }, [])

  const markAppReady = useCallback(() => {
    dispatch({ type: 'app.ready' })
    if (!stateRef.current.mobileChat.questionPending) replaceHistory('button')
  }, [replaceHistory])

  const openChat = useCallback(() => {
    if (stateRef.current.mobileChat.mode !== 'button') return
    dispatch({ type: 'chat.open' })
    pushHistory('half')
  }, [pushHistory])

  const expandChat = useCallback(() => {
    if (stateRef.current.mobileChat.mode === 'full') return
    dispatch({ type: 'chat.expand' })
    // Half and full are two positions of the same open sheet. Back closes it
    // in one step rather than walking through every position.
    replaceHistory('full')
  }, [replaceHistory])

  const hideChat = useCallback(() => {
    dispatch({ type: 'chat.hide' })
    if (!stateRef.current.mobileChat.questionPending) closeHistory()
    else replaceHistory('half')
  }, [closeHistory, replaceHistory])

  const markAssistantMessage = useCallback(() => dispatch({ type: 'chat.assistant' }), [])

  const setQuestionPending = useCallback((pending: boolean) => {
    const shouldOpen = pending && stateRef.current.mobileChat.mode === 'button'
    dispatch({ type: 'chat.question', pending })
    if (shouldOpen) pushHistory('half')
  }, [pushHistory])

  return {
    ...state,
    clearSheet,
    clearActivity,
    markAppReady,
    openChat,
    expandChat,
    hideChat,
    markAssistantMessage,
    setQuestionPending,
  }
}
