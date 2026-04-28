import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SendMessageInput } from '../../shared/harness'

export type UseAgentChatOptions = Pick<
  SendMessageInput,
  'sessionId' | 'model' | 'thinkingLevel'
> & {
  onData?: (part: unknown) => void
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        body: () => ({
          sessionId: optsRef.current.sessionId,
          model: optsRef.current.model,
          thinkingLevel: optsRef.current.thinkingLevel,
        }),
      }),
    [sessionId],
  )

  const chat = useChat({
    id: sessionId,
    transport,
    resume: true,
    onData: (part) => {
      // File-change invalidation is no longer done here. The host
      // (e.g. @boring/workspace's ChatCenteredShell) wires onData to
      // its workspace event bus via `emitAgentFileChange`, and a
      // single subscriber handles React Query invalidation. See
      // `useFileEventInvalidation` in @boring/workspace/data.
      optsRef.current.onData?.(part)
    },
  })

  // Hydrate history on mount / session change. Priority:
  //  1. Server /messages endpoint (authoritative if the harness persists sessions)
  //  2. localStorage cache (fallback when pi-coding-agent uses SessionManager.inMemory)
  //
  // `hydrated` gates the save-to-cache effect below — without it, the save
  // effect fires first on mount with an empty messages array and wipes the
  // cached history before hydration has a chance to restore it.
  const setMessages = chat.setMessages
  const cacheKey = sessionId ? `boring-agent:messages:${sessionId}` : null
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!sessionId || !cacheKey) return
    let aborted = false
    setHydrated(false)

    const loadFromCache = () => {
      try {
        const cached = globalThis.localStorage?.getItem(cacheKey)
        if (!cached) return
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed as UIMessage[])
        }
      } catch { /* ignore parse errors */ }
    }

    fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/messages`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { messages?: UIMessage[] } | null) => {
        if (aborted) return
        const serverMessages = payload?.messages
        if (Array.isArray(serverMessages) && serverMessages.length > 0) {
          setMessages(serverMessages)
          return
        }
        loadFromCache()
      })
      .catch(() => {
        if (aborted) return
        loadFromCache()
      })
      .finally(() => {
        if (!aborted) setHydrated(true)
      })

    return () => { aborted = true }
  }, [sessionId, cacheKey, setMessages])

  // Mirror messages → localStorage whenever they change. Gated on `hydrated`
  // so the initial empty state never overwrites a previously-cached history.
  const messages = chat.messages
  useEffect(() => {
    if (!hydrated || !cacheKey) return
    try {
      globalThis.localStorage?.setItem(cacheKey, JSON.stringify(messages))
    } catch { /* quota exceeded: drop cache silently */ }
  }, [hydrated, cacheKey, messages])

  return chat
}
