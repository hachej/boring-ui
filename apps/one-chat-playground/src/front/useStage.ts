import { useCallback, useEffect, useReducer } from 'react'

import { initialStageState, parseStageEvent, stageReducer, type StageState } from '../shared/stage.js'

export const STAGE_STREAM_URL = '/api/one-chat/stage/stream'
export const STAGE_CLEAR_URL = '/api/one-chat/stage/clear'
export const ACTIVITY_CLEAR_URL = '/api/one-chat/activity/clear'

export interface UseStageResult extends StageState {
  /** Dismiss the sheet. Goes through the server so every open tab agrees. */
  clearSheet: () => void
  /** Clear a completed sketch/build once the colleague starts speaking. */
  clearActivity: () => void
}

/** Subscribes the stage to the server's SSE channel. The reducer stays pure and tested. */
export function useStage(streamUrl: string = STAGE_STREAM_URL): UseStageResult {
  const [state, dispatch] = useReducer(stageReducer, initialStageState)

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
      if (stageEvent) dispatch(stageEvent)
    }
    return () => source.close()
  }, [streamUrl])

  const clearSheet = useCallback(() => {
    // Optimistic: the SSE echo is idempotent, and the button must feel instant.
    dispatch({ type: 'stage.clear' })
    void fetch(STAGE_CLEAR_URL, { method: 'POST' }).catch(() => {})
  }, [])

  const clearActivity = useCallback(() => {
    dispatch({ type: 'activity.clear' })
    void fetch(ACTIVITY_CLEAR_URL, { method: 'POST' }).catch(() => {})
  }, [])

  return { ...state, clearSheet, clearActivity }
}
