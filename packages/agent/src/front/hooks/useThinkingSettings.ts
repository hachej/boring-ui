import { useEffect, useState } from 'react'
import {
  DEFAULT_THINKING,
  readStoredShowThoughts,
  readStoredThinking,
  writeStoredShowThoughts,
  writeStoredThinking,
  type ThinkingLevel,
} from '../chatPanelSettings'

export function useThinkingSettings(thinkingControl: boolean) {
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() =>
    thinkingControl ? readStoredThinking() : DEFAULT_THINKING,
  )
  const [showThoughts, setShowThoughts] = useState<boolean>(() => readStoredShowThoughts())

  useEffect(() => {
    if (!thinkingControl) return
    writeStoredThinking(thinkingLevel)
  }, [thinkingControl, thinkingLevel])

  useEffect(() => {
    writeStoredShowThoughts(showThoughts)
  }, [showThoughts])

  return {
    thinkingLevel,
    setThinkingLevel,
    showThoughts,
    setShowThoughts,
  }
}
