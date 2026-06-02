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
  persistMessages?: boolean
  hydrateMessages?: boolean
}

function collapseExactRepeatedText(text: string): string {
  const maxCopies = Math.min(20, Math.floor(text.length / 8))
  for (let copies = maxCopies; copies >= 2; copies--) {
    if (text.length % copies !== 0) continue
    const unit = text.slice(0, text.length / copies)
    if (unit.length < 8) continue
    if (unit.repeat(copies) === text) return unit
  }
  return text
}

function normalizeMessage(message: UIMessage): UIMessage {
  if (message.role !== 'assistant') return message
  let changed = false
  const parts = message.parts?.map((part) => {
    const candidate = part as Record<string, unknown>
    if (candidate.type !== 'text' || typeof candidate.text !== 'string') return part
    const text = collapseExactRepeatedText(candidate.text)
    if (text === candidate.text) return part
    changed = true
    return { ...candidate, text } as typeof part
  })
  return changed ? { ...message, parts } : message
}

function messageContentKey(message: UIMessage): string {
  const normalized = normalizeMessage(message)
  return `${normalized.role}:${JSON.stringify(normalized.parts ?? [])}`
}

function mergeMessages(base: UIMessage[], tail: UIMessage[]): UIMessage[] {
  const seenIds = new Set<string>()
  const seenContent = new Set<string>()
  const merged: UIMessage[] = []
  for (const rawMessage of [...base, ...tail]) {
    const message = normalizeMessage(rawMessage)
    const id = typeof message.id === 'string' ? message.id : undefined
    const contentKey = messageContentKey(message)
    if (id) {
      if (seenIds.has(id)) continue
      seenIds.add(id)
    } else {
      if (seenContent.has(contentKey)) continue
      seenContent.add(contentKey)
    }
    merged.push(message)
  }
  return merged
}

function sameMessageOrder(a: UIMessage[], b: UIMessage[]): boolean {
  if (a.length !== b.length) return false
  return a.every((message, index) => {
    const other = b[index]
    return message.id === other?.id && JSON.stringify(message.parts ?? []) === JSON.stringify(other?.parts ?? [])
  })
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const hydrateMessages = opts.hydrateMessages ?? true
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
    resume: hydrateMessages,
    // Match AI SDK's documented React smoothing knob: render at most every
    // ~50ms while chunks stream instead of once per incoming chunk. This only
    // throttles AI SDK's own messages store; pi's custom data-pi projection
    // does its own matching delta batching in usePiChatProjection.
    experimental_throttle: 50,
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
  const [hydratedKey, setHydratedKey] = useState<string | null>(null)
  const hydrated = !hydrateMessages || !sessionId || !cacheKey || hydratedKey === cacheKey

  useEffect(() => {
    if (!sessionId || !cacheKey) return
    if (!hydrateMessages) {
      setHydratedKey(cacheKey)
      return
    }
    let aborted = false
    setHydratedKey(null)

    const readCachedMessages = (): UIMessage[] => {
      try {
        const cached = globalThis.localStorage?.getItem(cacheKey)
        if (!cached) return []
        const parsed = JSON.parse(cached)
        return Array.isArray(parsed) ? parsed as UIMessage[] : []
      } catch {
        return []
      }
    }

    const hydrateMerged = (serverMessages: UIMessage[], cachedMessages: UIMessage[]) => {
      const current = messagesRef.current
      const fromServerAndCache = mergeMessages(serverMessages, cachedMessages)
      const next = current.length > 0 ? mergeMessages(fromServerAndCache, current) : fromServerAndCache
      if (next.length > 0) setMessages(next)
    }

    const loadFromCache = () => {
      const cachedMessages = readCachedMessages()
      if (cachedMessages.length > 0) hydrateMerged([], cachedMessages)
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
        const cachedMessages = readCachedMessages()
        if (Array.isArray(serverMessages) && serverMessages.length > 0) {
          hydrateMerged(serverMessages, cachedMessages)
          return
        }
        if (cachedMessages.length > 0) hydrateMerged([], cachedMessages)
      })
      .catch(() => {
        if (aborted) return
        loadFromCache()
      })
      .finally(() => {
        if (!aborted) setHydratedKey(cacheKey)
      })

    return () => { aborted = true }
  }, [hydrateMessages, sessionId, cacheKey, setMessages])

  // Mirror messages → localStorage whenever they change. Gated on `hydrated`
  // so the initial empty state never overwrites a previously-cached history.
  // Also skip empty messages: when sessionId changes, useChat resets to []
  // before hydration runs, and saving [] would wipe the previous cache for the
  // new session before we get a chance to read it.
  const messages = chat.messages
  const status = chat.status
  const messagesRef = useRef(messages)
  const statusRef = useRef(status)
  messagesRef.current = messages
  statusRef.current = status
  useEffect(() => {
    if (messages.length === 0) return
    const deduped = mergeMessages([], messages)
    if (!sameMessageOrder(messages, deduped)) setMessages(deduped)
  }, [messages, setMessages])

  useEffect(() => {
    if (opts.persistMessages === false) return
    if (!hydrated || !cacheKey) return
    if (messages.length === 0) return
    // Only save when messages actually changed (not on every render).
    // The `messages` dependency already handles this, but we also skip
    // saves during hydration to avoid overwriting with partial state.
    try {
      globalThis.localStorage?.setItem(cacheKey, JSON.stringify(messages))
    } catch { /* quota exceeded: drop cache silently */ }
  }, [opts.persistMessages, hydrated, cacheKey, messages])

  // When the stream ends (stop or natural completion), settle any tool parts
  // still stuck in a non-settled state so the UI doesn't shimmer forever.
  const SETTLED_STATES = new Set([
    'output-available',
    'output-error',
    'output-denied',
    'approval-responded',
  ])
  const prevSettleRef = useRef(status)
  useEffect(() => {
    const prev = prevSettleRef.current
    prevSettleRef.current = status
    if (status !== 'ready') return
    if (prev !== 'streaming' && prev !== 'submitted') return
    const hasUnsettled = messages.some((msg) =>
      msg.parts?.some((p) => {
        const part = p as Record<string, unknown>
        return typeof part.type === 'string' && part.type.startsWith('tool-') && !SETTLED_STATES.has(part.state as string)
      })
    )
    if (!hasUnsettled) return
    setMessages((prev) =>
      prev.map((msg) => ({
        ...msg,
        parts: msg.parts?.map((p) => {
          const part = p as Record<string, unknown>
          if (typeof part.type === 'string' && part.type.startsWith('tool-') && !SETTLED_STATES.has(part.state as string)) {
            return { ...part, state: 'output-error' }
          }
          return p
        }),
      })) as typeof prev
    )
  }, [status, setMessages])

  // Push a server-side snapshot after each completed turn. Fires only when
  // status transitions from streaming → ready, not on every message change,
  // so we don't spam the server during hydration or between turns.
  const prevStatusRef = useRef<typeof status>(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (opts.persistMessages === false) return
    if (status !== 'ready') return
    // Only save when we're settling from an active streaming turn.
    if (prev !== 'streaming' && prev !== 'submitted') return
    if (!sessionId || messages.length === 0) return
    const url = `/api/v1/agent/chat/${encodeURIComponent(sessionId)}/messages`
    // Strip data URLs from attachment parts before persisting — they can be
    // several MB each and bloat the JSONL session file. The UI already
    // rendered the image; history only needs provenance (filename, mediaType).
    const stripped = messages.map((msg) => ({
      ...msg,
      parts: msg.parts?.map((part: unknown) => {
        const p = part as Record<string, unknown>
        if (p.type === 'file' && typeof p.url === 'string' && p.url.startsWith('data:')) {
          return { ...p, url: '' }
        }
        return part
      }),
    }))
    fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...optsRef.current.requestHeaders,
      },
      body: JSON.stringify({ messages: stripped }),
    }).catch(() => { /* best-effort, ignore failures */ })
  }, [opts.persistMessages, sessionId, status, messages])

  return { ...chat, hydrated, hydratingMessages: hydrateMessages && Boolean(sessionId) && !hydrated }
}
