import { useCallback, useEffect, useReducer, useRef } from 'react'

import {
  chatPresenceReducer,
  createInitialChatPresence,
  firstReplyLine,
  initialStageState,
  parseStageEvent,
  replyNeedsRoom,
  stageReducer,
  type ChatPresenceState,
  type DesktopChatPresence,
  type MobileChatPresence,
  type StageState,
} from '../shared/stage.js'

export const STAGE_STREAM_URL = '/api/one-chat/stage/stream'
export const STAGE_CLEAR_URL = '/api/one-chat/stage/clear'
export const ACTIVITY_CLEAR_URL = '/api/one-chat/activity/clear'
export const CHAT_PRESENCE_STORAGE_PREFIX = 'one-chat:chat-presence:'

export interface UseStageResult extends StageState {
  readonly chatPresence: ChatPresenceState
  /** Dismiss the stage overlay. Goes through the server so every open tab agrees. */
  clearSheet: () => void
  /** Clear a completed sketch/build once the colleague starts speaking. */
  clearActivity: () => void
  markAppReady: () => void
  openChat: () => void
  expandChat: () => void
  hideChat: () => void
  userExpand: () => void
  userCollapse: () => void
  markAssistantMessage: (text: string) => void
  setQuestionPending: (pending: boolean) => void
}

function readDesktopPresence(appSlug: string): DesktopChatPresence | null {
  try {
    const value = window.localStorage.getItem(`${CHAT_PRESENCE_STORAGE_PREFIX}${appSlug}`)
    return value === 'bar' || value === 'window' || value === 'column' ? value : null
  } catch {
    return null
  }
}

function storeDesktopPresence(appSlug: string, mode: DesktopChatPresence): void {
  try {
    window.localStorage.setItem(`${CHAT_PRESENCE_STORAGE_PREFIX}${appSlug}`, mode)
  } catch {
    // The ladder still works for this page when storage is unavailable.
  }
}

/** Subscribes the stage to the server's SSE channel. Both responsive ladders use one pure reducer. */
export function useStage(appSlug: string, mobile: boolean, streamUrl: string = STAGE_STREAM_URL): UseStageResult {
  const [state, dispatch] = useReducer(stageReducer, initialStageState)
  const [chatPresence, dispatchPresence] = useReducer(
    chatPresenceReducer,
    createInitialChatPresence(mobile ? 'phone' : 'desktop', mobile ? null : readDesktopPresence(appSlug)),
  )
  const stateRef = useRef(state)
  const presenceRef = useRef(chatPresence)
  stateRef.current = state
  presenceRef.current = chatPresence

  const historyMode = (): MobileChatPresence | undefined => {
    const queryMode = new URLSearchParams(window.location.search).get('chat')
    if (queryMode === 'button' || queryMode === 'half' || queryMode === 'full') return queryMode
    const value = window.history.state as { oneChatMode?: unknown } | null
    return value?.oneChatMode === 'button' || value?.oneChatMode === 'half' || value?.oneChatMode === 'full'
      ? value.oneChatMode
      : undefined
  }
  const historyUrl = (mode: MobileChatPresence) => {
    const url = new URL(window.location.href)
    if (mode === 'button') url.searchParams.delete('chat')
    else url.searchParams.set('chat', mode)
    return `${url.pathname}${url.search}${url.hash}`
  }
  const replaceHistory = useCallback((mode: MobileChatPresence) => {
    window.history.replaceState({ ...(window.history.state ?? {}), oneChatMode: mode }, '', historyUrl(mode))
  }, [])
  const pushHistory = useCallback((mode: MobileChatPresence) => {
    window.history.pushState({ ...(window.history.state ?? {}), oneChatMode: mode }, '', historyUrl(mode))
  }, [])
  const closeHistory = useCallback(() => {
    if (historyMode() === 'half' || historyMode() === 'full') window.history.back()
    else replaceHistory('button')
  }, [replaceHistory])

  useEffect(() => {
    if (!mobile) return
    if (!historyMode()) replaceHistory('full')
    const onPopState = (event: PopStateEvent) => {
      const value = event.state as { oneChatMode?: unknown } | null
      const mode = value?.oneChatMode === 'half' || value?.oneChatMode === 'full' ? value.oneChatMode : 'button'
      dispatchPresence({ type: 'restore', mode })
      if (mode === 'button' && presenceRef.current.questionPending) pushHistory('half')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [mobile, pushHistory, replaceHistory])

  useEffect(() => {
    if (mobile || !chatPresence.stageSeen) return
    storeDesktopPresence(appSlug, chatPresence.mode as DesktopChatPresence)
  }, [appSlug, chatPresence.mode, chatPresence.stageSeen, mobile])

  useEffect(() => {
    if (mobile || !chatPresence.peek) return
    const replyVersion = chatPresence.replyVersion
    const timer = window.setTimeout(() => dispatchPresence({ type: 'peekExpired', replyVersion }), 6_000)
    return () => window.clearTimeout(timer)
  }, [chatPresence.peek, chatPresence.replyVersion, mobile])

  useEffect(() => {
    dispatch({ type: 'stage.clear' })
    if (mobile) {
      dispatchPresence({ type: 'restore', mode: 'full' })
      replaceHistory('full')
    }
    const source = new EventSource(`${streamUrl}?app=${encodeURIComponent(appSlug)}`)
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
      if (stageEvent.type === 'stage.show') {
        const presence = presenceRef.current
        dispatchPresence({ type: 'stageShown' })
        if (mobile) {
          const mode = presence.questionPending
            ? (presence.mode === 'full' ? 'full' : 'half')
            : 'button'
          replaceHistory(mode)
        }
      } else if (mobile && stageEvent.type === 'stage.clear') {
        dispatchPresence({ type: 'restore', mode: 'full' })
        replaceHistory('full')
      }
    }
    return () => source.close()
  }, [appSlug, mobile, replaceHistory, streamUrl])

  const clearSheet = useCallback(() => {
    dispatch({ type: 'stage.clear' })
    if (mobile) {
      dispatchPresence({ type: 'restore', mode: 'full' })
      replaceHistory('full')
    }
    void fetch(STAGE_CLEAR_URL, { method: 'POST', headers: { 'x-one-chat-app': appSlug } }).catch(() => {})
  }, [appSlug, mobile, replaceHistory])

  const clearActivity = useCallback(() => {
    dispatch({ type: 'activity.clear' })
    void fetch(ACTIVITY_CLEAR_URL, { method: 'POST', headers: { 'x-one-chat-app': appSlug } }).catch(() => {})
  }, [appSlug])

  const markAppReady = useCallback(() => {
    if (!mobile) return
    const mode = presenceRef.current.questionPending
      ? (presenceRef.current.mode === 'full' ? 'full' : 'half')
      : 'button'
    replaceHistory(mode)
  }, [mobile, replaceHistory])

  const userExpand = useCallback(() => dispatchPresence({ type: 'userExpand' }), [])
  const userCollapse = useCallback(() => dispatchPresence({ type: 'userCollapse' }), [])

  const openChat = useCallback(() => {
    if (presenceRef.current.mode !== 'button') return
    dispatchPresence({ type: 'userExpand' })
    pushHistory('half')
  }, [pushHistory])

  const expandChat = useCallback(() => {
    if (presenceRef.current.mode === 'full') return
    dispatchPresence({ type: 'userExpand' })
    replaceHistory('full')
  }, [replaceHistory])

  const hideChat = useCallback(() => {
    dispatchPresence({ type: 'userCollapse' })
    if (!presenceRef.current.questionPending) closeHistory()
    else replaceHistory('half')
  }, [closeHistory, replaceHistory])

  const markAssistantMessage = useCallback((text: string) => {
    if (!stateRef.current.screen) return
    const preview = firstReplyLine(text)
    if (!preview) return
    dispatchPresence({ type: 'replyArrived', preview })
    if (!mobile && replyNeedsRoom(text)) dispatchPresence({ type: 'colleagueNeedsRoom' })
  }, [mobile])

  const setQuestionPending = useCallback((pending: boolean) => {
    const shouldOpenPhone = mobile && pending && presenceRef.current.mode === 'button'
    dispatchPresence({ type: 'cardPending', pending })
    if (shouldOpenPhone) pushHistory('half')
  }, [mobile, pushHistory])

  return {
    ...state,
    chatPresence,
    clearSheet,
    clearActivity,
    markAppReady,
    openChat,
    expandChat,
    hideChat,
    userExpand,
    userCollapse,
    markAssistantMessage,
    setQuestionPending,
  }
}
