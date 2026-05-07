import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SendMessageInput } from '../../shared/harness'

export type UseAgentChatOptions = Pick<
  SendMessageInput,
  'sessionId' | 'model' | 'thinkingLevel'
> & {
  onData?: (part: unknown) => void
  requestHeaders?: Record<string, string>
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const optsRef = useRef(opts)
  optsRef.current = opts

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        headers: () => optsRef.current.requestHeaders ?? {},
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
      // (e.g. @hachej/boring-workspace's ChatCenteredShell) wires onData to
      // its workspace event bus via `emitAgentFileChange`, and a
      // single subscriber handles React Query invalidation. See
      // `useFileEventInvalidation` in @hachej/boring-workspace/data.
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

    const fetchOpts = optsRef.current.requestHeaders
      ? { headers: optsRef.current.requestHeaders }
      : undefined
    const messagesUrl = `/api/v1/agent/chat/${encodeURIComponent(sessionId)}/messages`
    const request = fetchOpts ? fetch(messagesUrl, fetchOpts) : fetch(messagesUrl)
    request
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
  // Also skip empty messages: when sessionId changes, useChat resets to []
  // before hydration runs, and saving [] would wipe the previous cache for the
  // new session before we get a chance to read it.
  const messages = chat.messages
  useEffect(() => {
    if (!hydrated || !cacheKey || messages.length === 0) return
    try {
      globalThis.localStorage?.setItem(cacheKey, JSON.stringify(messages))
    } catch { /* quota exceeded: drop cache silently */ }
  }, [hydrated, cacheKey, messages])

  // Push a server-side snapshot after each completed turn. Fires only when
  // status transitions from streaming → ready, not on every message change,
  // so we don't spam the server during hydration or between turns.
  const status = chat.status
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (status !== 'ready') return
    // Only save when we're settling from an active streaming turn.
    if (prev !== 'streaming' && prev !== 'submitted') return
    if (!sessionId || messages.length === 0) return
    const url = `/api/v1/agent/chat/${encodeURIComponent(sessionId)}/messages`
    fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...optsRef.current.requestHeaders,
      },
      body: JSON.stringify({ messages }),
    }).catch(() => { /* best-effort, ignore failures */ })
  }, [sessionId, status, messages])

  return chat
}
