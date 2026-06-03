import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SendMessageInput } from '../../shared/harness'
import { sanitizeUiMessage, sanitizeUiMessages, uiMessageContentKey } from '../../shared/message-sanitizer'

export type UseAgentChatOptions = Pick<
  SendMessageInput,
  'sessionId' | 'model' | 'thinkingLevel'
> & {
  onData?: (part: unknown) => void
  requestHeaders?: Record<string, string>
  persistMessages?: boolean
  hydrateMessages?: boolean
}

function mergeMessages(base: UIMessage[], tail: UIMessage[], opts?: { dedupePendingAgainstStable?: boolean }): UIMessage[] {
  const seenIds = new Set<string>()
  const seenContent = new Set<string>()
  const stableContent = new Set<string>()
  const pendingUserContent = new Map<string, number>()
  const merged: UIMessage[] = []
  for (const rawMessage of [...base, ...tail]) {
    const message = sanitizeUiMessage(rawMessage)
    const id = typeof message.id === 'string' ? message.id : undefined
    const contentKey = uiMessageContentKey(message)
    const pendingUser = id?.startsWith('pending-user:') === true
    if (id) {
      if (seenIds.has(id)) continue
      if (pendingUser && (seenContent.has(contentKey) || (opts?.dedupePendingAgainstStable !== false && stableContent.has(contentKey)))) continue
      if (!pendingUser) {
        const pendingIndex = pendingUserContent.get(contentKey)
        if (pendingIndex !== undefined) {
          merged[pendingIndex] = message
          seenIds.add(id)
          seenContent.add(contentKey)
          pendingUserContent.delete(contentKey)
          continue
        }
      }
      seenIds.add(id)
      if (pendingUser) {
        pendingUserContent.set(contentKey, merged.length)
      } else {
        stableContent.add(contentKey)
      }
    } else {
      if (seenContent.has(contentKey)) continue
      seenContent.add(contentKey)
    }
    merged.push(message)
  }
  return sanitizeUiMessages(merged)
}

function sameMessageOrder(a: UIMessage[], b: UIMessage[]): boolean {
  if (a.length !== b.length) return false
  return a.every((message, index) => {
    const other = b[index]
    return message.id === other?.id && JSON.stringify(message.parts ?? []) === JSON.stringify(other?.parts ?? [])
  })
}

function sameMessageIdentityOrContent(a: UIMessage | undefined, b: UIMessage | undefined): boolean {
  if (!a || !b) return false
  if (typeof a.id === 'string' && typeof b.id === 'string' && a.id === b.id) return true
  return uiMessageContentKey(a) === uiMessageContentKey(b)
}

function mergeHydratedMessages(serverMessages: UIMessage[], cachedMessages: UIMessage[]): UIMessage[] {
  if (serverMessages.length === 0) return mergeMessages([], cachedMessages)
  if (cachedMessages.length === 0) return mergeMessages([], serverMessages)
  let commonPrefix = 0
  while (
    commonPrefix < serverMessages.length
    && commonPrefix < cachedMessages.length
    && sameMessageIdentityOrContent(serverMessages[commonPrefix], cachedMessages[commonPrefix])
  ) {
    commonPrefix += 1
  }
  if (commonPrefix > 0 && commonPrefix < cachedMessages.length && commonPrefix < serverMessages.length) {
    return mergeMessages(serverMessages.slice(0, commonPrefix), [
      ...cachedMessages.slice(commonPrefix),
      ...serverMessages.slice(commonPrefix),
    ])
  }
  const firstCached = cachedMessages[0]
  const serverHasUser = serverMessages.some((message) => message.role === 'user')
  if (
    commonPrefix === 0
    && !serverHasUser
    && firstCached?.role === 'user'
    && typeof firstCached.id === 'string'
    && firstCached.id.startsWith('pending-user:')
    && serverMessages[0]?.role === 'assistant'
  ) {
    return mergeMessages([], [...cachedMessages, ...serverMessages])
  }
  return mergeMessages(serverMessages, cachedMessages)
}

function messagesLookSettled(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return false
  return !last.parts?.some((part) => {
    const candidate = part as Record<string, unknown>
    return typeof candidate.type === 'string'
      && candidate.type.startsWith('tool-')
      && candidate.state !== 'output-available'
      && candidate.state !== 'output-error'
      && candidate.state !== 'output-denied'
      && candidate.state !== 'approval-responded'
  })
}

function readCachedMessages(cacheKey: string): UIMessage[] {
  try {
    const cached = globalThis.localStorage?.getItem(cacheKey)
    if (!cached) return []
    const parsed = JSON.parse(cached)
    return Array.isArray(parsed) ? parsed as UIMessage[] : []
  } catch {
    return []
  }
}

function messagesNeedResume(cachedMessages: UIMessage[]): boolean {
  const last = cachedMessages[cachedMessages.length - 1]
  if (!last) return false
  if (last.role === 'user') return true
  return Boolean(last.parts?.some((part) => {
    const candidate = part as Record<string, unknown>
    if (typeof candidate.type === 'string' && candidate.type.startsWith('tool-')) {
      return candidate.state !== 'output-available'
        && candidate.state !== 'output-error'
        && candidate.state !== 'output-denied'
        && candidate.state !== 'approval-responded'
    }
    return false
  }))
}

function cachedMessagesNeedResume(cacheKey: string): boolean {
  return messagesNeedResume(readCachedMessages(cacheKey))
}

function cachedStatusNeedsResume(statusKey: string): boolean {
  try {
    return globalThis.localStorage?.getItem(statusKey) === 'active'
  } catch {
    return false
  }
}

function createClientTurnId(): string {
  return `turn:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

function turnIdFromDataPart(part: unknown): string | null {
  const candidate = part as { type?: unknown; data?: { turnId?: unknown } } | undefined
  if (candidate?.type !== 'data-turn-start') return null
  return typeof candidate.data?.turnId === 'string' && candidate.data.turnId.length > 0 ? candidate.data.turnId : null
}

function optimisticUserMessageFromSendArgs(args: unknown[]): UIMessage | null {
  const input = args[0] as { text?: unknown } | undefined
  const text = typeof input?.text === 'string' ? input.text : ''
  if (!text.trim()) return null
  return {
    id: `pending-user:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    role: 'user',
    parts: [{ type: 'text', text }],
  } as UIMessage
}

function writeCachedMessages(cacheKey: string, messages: UIMessage[]): void {
  try {
    globalThis.localStorage?.setItem(cacheKey, JSON.stringify(messages))
  } catch { /* quota exceeded: drop cache silently */ }
}

function clearCachedMessages(cacheKey: string): void {
  try {
    globalThis.localStorage?.removeItem?.(cacheKey)
  } catch { /* storage unavailable: ignore */ }
}

export function useAgentChat(opts: UseAgentChatOptions) {
  const { sessionId } = opts
  const hydrateMessages = opts.hydrateMessages ?? true
  const optsRef = useRef(opts)
  optsRef.current = opts

  const cacheKey = sessionId ? `boring-agent:messages:${sessionId}` : null
  const statusKey = sessionId ? `boring-agent:status:${sessionId}` : null
  const [settledResumeKey, setSettledResumeKey] = useState<string | null>(null)
  const shouldResume = useMemo(
    () => hydrateMessages && Boolean(
      cacheKey
      && settledResumeKey !== cacheKey
      && (cachedMessagesNeedResume(cacheKey) || (statusKey ? cachedStatusNeedsResume(statusKey) : false)),
    ),
    [cacheKey, hydrateMessages, settledResumeKey, statusKey],
  )

  const activeTurnIdRef = useRef<string | null>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent/chat',
        headers: () => optsRef.current.requestHeaders ?? {},
        body: () => ({
          sessionId: optsRef.current.sessionId,
          model: optsRef.current.model,
          thinkingLevel: optsRef.current.thinkingLevel,
          ...(activeTurnIdRef.current ? { clientTurnId: activeTurnIdRef.current } : {}),
        }),
      }),
    [sessionId],
  )

  const chat = useChat({
    id: sessionId,
    transport,
    resume: shouldResume,
    // Match AI SDK's documented React smoothing knob: render at most every
    // ~50ms while chunks stream instead of once per incoming chunk. This only
    // throttles AI SDK's own messages store; pi's custom data-pi projection
    // does its own matching delta batching in usePiChatProjection.
    experimental_throttle: 50,
    onData: (part) => {
      const turnId = turnIdFromDataPart(part)
      if (turnId) activeTurnIdRef.current = turnId
      // File-change invalidation is no longer done here. The host
      // (e.g. @hachej/boring-workspace's ChatCenteredShell) wires onData to
      // its workspace event bus via `emitAgentFileChange`, and a
      // single subscriber handles React Query invalidation. See
      // `useFileEventInvalidation` in @hachej/boring-workspace/data.
      optsRef.current.onData?.(part)
    },
  })

  const rawMessages = chat.messages
  const messages = useMemo(() => mergeMessages([], rawMessages), [rawMessages])
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const rawStop = chat.stop

  const stop = useCallback(() => {
    rawStop()
    if (!sessionId) return
    const turnId = activeTurnIdRef.current
    const suffix = turnId ? `?turnId=${encodeURIComponent(turnId)}` : ''
    fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/turn${suffix}`, {
      method: 'DELETE',
      headers: optsRef.current.requestHeaders,
    }).catch(() => { /* best-effort cancellation */ })
  }, [rawStop, sessionId])

  const [localTurnActive, setLocalTurnActive] = useState(false)
  const localTurnVersionRef = useRef(0)
  useEffect(() => {
    setLocalTurnActive(false)
  }, [sessionId])

  const sendMessage = useCallback((...args: Parameters<typeof chat.sendMessage>) => {
    activeTurnIdRef.current = createClientTurnId()
    localTurnVersionRef.current += 1
    setLocalTurnActive(true)
    setSettledResumeKey((current) => (current === cacheKey ? null : current))
    if (cacheKey) {
      const optimisticUser = optimisticUserMessageFromSendArgs(args)
      if (optimisticUser) {
        const cachedMessages = readCachedMessages(cacheKey)
        const base = messagesRef.current.length > 0 ? messagesRef.current : cachedMessages
        const next = mergeMessages(base, [optimisticUser], { dedupePendingAgainstStable: false })
        writeCachedMessages(cacheKey, next)
      }
    }
    if (statusKey) {
      try {
        globalThis.localStorage?.setItem(statusKey, 'active')
      } catch { /* quota exceeded: drop status cache silently */ }
    }
    return chat.sendMessage(...args)
  }, [cacheKey, chat.sendMessage, statusKey])

  // Hydrate history on mount / session change. Priority:
  //  1. Server /messages endpoint (authoritative if the harness persists sessions)
  //  2. localStorage cache (fallback when pi-coding-agent uses SessionManager.inMemory)
  //
  // `hydrated` gates the save-to-cache effect below — without it, the save
  // effect fires first on mount with an empty messages array and wipes the
  // cached history before hydration has a chance to restore it.
  const setMessages = chat.setMessages
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
    const hydrateLocalTurnVersion = localTurnVersionRef.current

    const hydrateMerged = (serverMessages: UIMessage[], cachedMessages: UIMessage[]) => {
      const current = messagesRef.current
      const fromServerAndCache = mergeHydratedMessages(serverMessages, cachedMessages)
      const next = current.length > 0 ? mergeMessages(fromServerAndCache, current) : fromServerAndCache
      if (next.length > 0) {
        setMessages(next)
        const serverLatest = serverMessages[serverMessages.length - 1]
        const cachedLatest = cachedMessages[cachedMessages.length - 1]
        const serverCoversCachedTail = !messagesNeedResume(cachedMessages)
          || (serverLatest && cachedLatest && sameMessageIdentityOrContent(serverLatest, cachedLatest))
          || serverMessages.length >= cachedMessages.length
        const authoritativeSettledServerTail = Boolean(
          serverLatest
          && serverCoversCachedTail
          && messagesLookSettled(serverMessages),
        )
        if (authoritativeSettledServerTail) {
          setSettledResumeKey(cacheKey)
          // A stale local "active" marker may have already triggered AI SDK
          // resume before hydration finished. Once the server proves the turn
          // is settled, stop that reconnect attempt, but never cancel a user
          // turn that started after this hydration request began.
          if (localTurnVersionRef.current === hydrateLocalTurnVersion) rawStop()
          clearCachedMessages(cacheKey)
          if (statusKey) {
            try {
              globalThis.localStorage?.setItem(statusKey, 'ready')
            } catch { /* quota exceeded: drop status cache silently */ }
          }
        }
      }
    }

    const loadFromCache = () => {
      const cachedMessages = readCachedMessages(cacheKey)
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
        const cachedMessages = readCachedMessages(cacheKey)
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
  }, [hydrateMessages, sessionId, cacheKey, setMessages, statusKey, rawStop])

  // Mirror messages → localStorage whenever they change. Gated on `hydrated`
  // so the initial empty state never overwrites a previously-cached history.
  // Also skip empty messages: when sessionId changes, useChat resets to []
  // before hydration runs, and saving [] would wipe the previous cache for the
  // new session before we get a chance to read it.
  const rawStatus = chat.status
  const rawStatusActive = rawStatus === 'submitted' || rawStatus === 'streaming'
  const knownActiveTurn = localTurnActive || shouldResume
  const hydratingWithoutMessages = hydrateMessages && Boolean(sessionId) && !hydrated && messages.length === 0
  const status = hydratingWithoutMessages
    ? 'ready'
    : rawStatusActive && !knownActiveTurn
      ? 'ready'
      : knownActiveTurn && rawStatus === 'ready'
        ? 'submitted'
        : rawStatus
  const prevRawStatusRef = useRef(rawStatus)
  useEffect(() => {
    const prev = prevRawStatusRef.current
    prevRawStatusRef.current = rawStatus
    const prevActive = prev === 'submitted' || prev === 'streaming'
    if (prevActive && (rawStatus === 'ready' || rawStatus === 'error')) {
      setLocalTurnActive(false)
      activeTurnIdRef.current = null
      if (cacheKey && statusKey && shouldResume) {
        setSettledResumeKey(cacheKey)
        clearCachedMessages(cacheKey)
        try {
          globalThis.localStorage?.setItem(statusKey, 'ready')
        } catch { /* quota exceeded: drop status cache silently */ }
      }
    }
  }, [rawStatus, sessionId, cacheKey, statusKey, shouldResume])

  useEffect(() => {
    if (!statusKey) return
    try {
      if (knownActiveTurn) {
        globalThis.localStorage?.setItem(statusKey, 'active')
      } else if (rawStatus === 'ready' || rawStatus === 'error' || rawStatusActive) {
        globalThis.localStorage?.setItem(statusKey, 'ready')
      }
    } catch { /* quota exceeded: drop status cache silently */ }
  }, [knownActiveTurn, rawStatus, rawStatusActive, statusKey])
  useEffect(() => {
    if (messages.length === 0) return
    const deduped = mergeMessages([], rawMessages)
    if (!sameMessageOrder(rawMessages, deduped)) setMessages(deduped)
  }, [rawMessages, messages.length, setMessages])

  useEffect(() => {
    if (opts.persistMessages === false) return
    if (!hydrated || !cacheKey) return
    if (messages.length === 0) return
    // Only save when messages actually changed (not on every render).
    // The `messages` dependency already handles this, but we also skip
    // saves during hydration to avoid overwriting with partial state.
    writeCachedMessages(cacheKey, mergeMessages([], messages))
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
    const persistedMessages = mergeMessages([], messages)
    const stripped = persistedMessages.map((msg) => ({
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

  return { ...chat, messages, sendMessage, stop, status, hydrated, hydratingMessages: hydrateMessages && Boolean(sessionId) && !hydrated }
}
