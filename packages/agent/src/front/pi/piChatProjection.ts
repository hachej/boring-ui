import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'

function asPiDataPart(part: UIMessage['parts'][number]): { type: string; data?: Record<string, unknown> } | null {
  const typed = part as { type?: unknown; data?: unknown }
  if (typeof typed.type !== 'string' || !typed.type.startsWith('data-pi-')) return null
  return {
    type: typed.type,
    data: typeof typed.data === 'object' && typed.data !== null ? typed.data as Record<string, unknown> : undefined,
  }
}

const PI_DELTA_FLUSH_MS = 50

type BufferedPiDelta = {
  kind: 'text' | 'reasoning'
  messageId: string
  partId: string
  delta: string
}

function applyBufferedTextDelta(items: UIMessage[], messageId: string, partId: string, delta: string): UIMessage[] {
  const existing = items.some((item) => item.id === messageId) ? items : [...items, { id: messageId, role: 'assistant' as const, parts: [] }]
  return existing.map((item) => {
    if (item.id !== messageId) return item
    let found = false
    const parts = (item.parts ?? []).map((p) => {
      if (p.type === 'text' && ((p as { id?: string }).id ?? partId) === partId) {
        found = true
        return { ...p, text: `${p.text}${delta}` }
      }
      return p
    })
    return { ...item, parts: (found ? parts : [...parts, { type: 'text' as const, id: partId, text: delta }]) as UIMessage['parts'] }
  })
}

function applyBufferedReasoningDelta(items: UIMessage[], messageId: string, partId: string, delta: string): UIMessage[] {
  const existing = items.some((item) => item.id === messageId) ? items : [...items, { id: messageId, role: 'assistant' as const, parts: [] }]
  return existing.map((item) => {
    if (item.id !== messageId) return item
    let found = false
    const parts = (item.parts ?? []).map((p) => {
      if (p.type === 'reasoning' && (p as { id?: string }).id === partId) {
        found = true
        return { ...p, text: `${p.text}${delta}` }
      }
      return p
    })
    return { ...item, parts: (found ? parts : [...parts, { type: 'reasoning' as const, id: partId, text: delta }]) as UIMessage['parts'] }
  })
}

function applyBufferedDeltas(items: UIMessage[], deltas: BufferedPiDelta[]): UIMessage[] {
  return deltas.reduce(
    (next, entry) => entry.kind === 'text'
      ? applyBufferedTextDelta(next, entry.messageId, entry.partId, entry.delta)
      : applyBufferedReasoningDelta(next, entry.messageId, entry.partId, entry.delta),
    items,
  )
}

export function rebuildPiMessagesFromDataParts(sourceMessages: UIMessage[]): UIMessage[] {
  const dataParts = sourceMessages.flatMap((message) => message.parts ?? []).map(asPiDataPart).filter(Boolean) as Array<{ type: string; data?: Record<string, unknown> }>
  if (dataParts.length === 0) return []
  const rebuilt: UIMessage[] = []
  const ensureMessage = (id: string, role: 'user' | 'assistant', text = '') => {
    let msg = rebuilt.find((item) => item.id === id)
    if (!msg) {
      msg = { id, role, parts: text ? [{ type: 'text' as const, text }] : [] }
      rebuilt.push(msg)
    } else if (text && !(msg.parts ?? []).some((part) => part.type === 'text' && part.text)) {
      msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
    }
    return msg
  }
  for (const part of dataParts) {
    const data = part.data ?? {}
    const messageId = typeof data.messageId === 'string' ? data.messageId : undefined
    if (!messageId) continue
    if (part.type === 'data-pi-message-start' && (data.role === 'user' || data.role === 'assistant')) {
      ensureMessage(messageId, data.role, typeof data.text === 'string' ? data.text : '')
    } else if (part.type === 'data-pi-text-start') {
      const msg = ensureMessage(messageId, 'assistant')
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      if (!msg.parts?.some((p) => p.type === 'text' && (p as { id?: string }).id === partId)) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, id: partId, text: '' } as UIMessage['parts'][number]]
    } else if (part.type === 'data-pi-text-delta') {
      const msg = ensureMessage(messageId, 'assistant')
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      const delta = typeof data.delta === 'string' ? data.delta : ''
      let found = false
      msg.parts = (msg.parts ?? []).map((p) => {
        if (p.type === 'text' && ((p as { id?: string }).id ?? partId) === partId) {
          found = true
          return { ...p, text: `${p.text}${delta}` }
        }
        return p
      })
      if (!found) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, id: partId, text: delta } as UIMessage['parts'][number]]
    } else if (part.type === 'data-pi-text-end') {
      const msg = ensureMessage(messageId, 'assistant')
      const text = typeof data.text === 'string' ? data.text : ''
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      // Check for the specific partId (not just any text part) to avoid
      // adding duplicate text when a different partId already has content.
      if (text && !(msg.parts ?? []).some((p) => p.type === 'text' && (p as { id?: string }).id === partId && p.text)) {
        msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
      }
    } else if (part.type === 'data-pi-reasoning-start') {
      const msg = ensureMessage(messageId, 'assistant')
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      if (!msg.parts?.some((p) => p.type === 'reasoning' && (p as { id?: string }).id === partId)) msg.parts = [...(msg.parts ?? []), { type: 'reasoning' as const, id: partId, text: '' } as UIMessage['parts'][number]]
    } else if (part.type === 'data-pi-reasoning-delta') {
      const msg = ensureMessage(messageId, 'assistant')
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      const delta = typeof data.delta === 'string' ? data.delta : ''
      let found = false
      msg.parts = (msg.parts ?? []).map((p) => {
        if (p.type === 'reasoning' && (p as { id?: string }).id === partId) {
          found = true
          return { ...p, text: `${(p as { text?: string }).text ?? ''}${delta}` }
        }
        return p
      })
      if (!found) msg.parts = [...(msg.parts ?? []), { type: 'reasoning' as const, id: partId, text: delta } as UIMessage['parts'][number]]
    } else if (part.type === 'data-pi-tool-call-end') {
      const msg = ensureMessage(messageId, 'assistant')
      const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
      const toolName = typeof data.toolName === 'string' ? data.toolName : undefined
      if (toolCallId && toolName) {
        msg.parts = [...(msg.parts ?? []).filter((p) => (p as { toolCallId?: string }).toolCallId !== toolCallId), { type: `tool-${toolName}`, toolCallId, state: 'input-available', input: data.input }] as UIMessage['parts']
      }
    } else if (part.type === 'data-pi-tool-result') {
      const msg = ensureMessage(messageId, 'assistant')
      const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
      if (toolCallId) {
        msg.parts = (msg.parts ?? []).map((p) => (p as { toolCallId?: string }).toolCallId === toolCallId ? { ...p, state: data.isError ? 'output-error' : 'output-available', output: data.output } : p) as UIMessage['parts']
      }
    } else if (part.type === 'data-pi-message-end' && data.role === 'assistant') {
      const msg = ensureMessage(messageId, 'assistant')
      const text = typeof data.text === 'string' ? data.text : ''
      // data-pi-message-end carries the message's full text as a fallback for
      // when no text-end was emitted. It has no partId, so we cannot match
      // it against the streamed text part by id (pi's contentIndex for the
      // text block is usually >0 when the message also has reasoning/tool
      // blocks before it). Skip if any text part already holds content —
      // text-end has already deposited it.
      if (text && !(msg.parts ?? []).some((p) => p.type === 'text' && p.text)) {
        msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
      }
    }
  }
  return rebuilt
}

export function mergeRebuiltPiMessages(existing: UIMessage[], rebuilt: UIMessage[]): UIMessage[] {
  if (rebuilt.length === 0) return existing
  const rebuiltIds = new Set(rebuilt.map((message) => message.id))
  const preserved = existing.filter((message) => {
    if (rebuiltIds.has(message.id)) return false
    return !(message.parts ?? []).some((part) => typeof part.type === 'string' && part.type.startsWith('data-pi-'))
  })
  return [...preserved, ...rebuilt]
}

export function usePiChatProjection({
  messages,
  status,
  sessionId,
  requestHeaders,
}: {
  messages: UIMessage[]
  status: string
  sessionId: string
  requestHeaders?: Record<string, string>
}) {
  const [piMessages, setPiMessages] = useState<UIMessage[]>([])
  const piMessagesRef = useRef<UIMessage[]>([])
  const bufferedDeltaRef = useRef(new Map<string, BufferedPiDelta>())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePiMessages = useCallback((updater: (items: UIMessage[]) => UIMessage[]) => {
    const next = updater(piMessagesRef.current)
    piMessagesRef.current = next
    setPiMessages(next)
  }, [])

  const flushBufferedDeltas = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    const deltas = [...bufferedDeltaRef.current.values()]
    if (deltas.length === 0) return
    bufferedDeltaRef.current.clear()
    updatePiMessages((items) => applyBufferedDeltas(items, deltas))
  }, [updatePiMessages])

  const queueBufferedDelta = useCallback((entry: BufferedPiDelta) => {
    const key = `${entry.kind}:${entry.messageId}:${entry.partId}`
    const existing = bufferedDeltaRef.current.get(key)
    bufferedDeltaRef.current.set(key, existing ? { ...existing, delta: `${existing.delta}${entry.delta}` } : entry)
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushBufferedDeltas()
    }, PI_DELTA_FLUSH_MS)
  }, [flushBufferedDeltas])

  useEffect(() => () => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
  }, [])

  const previousSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    bufferedDeltaRef.current.clear()
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    piMessagesRef.current = []
    setPiMessages([])
  }, [sessionId])

  const handleData = useCallback((part: unknown) => {
    const typed = part as { type?: string; data?: Record<string, unknown> }
    const data = typed.data ?? {}
    const piMessageId = typeof data.messageId === 'string' ? data.messageId : undefined
    if (!piMessageId) return

    const isBufferedDelta = typed.type === 'data-pi-text-delta' || typed.type === 'data-pi-reasoning-delta'
    if (typed.type && !isBufferedDelta) flushBufferedDeltas()

    // Dispatch table for data-pi-* events — each handler receives (data, updatePiMessages)
    const handlers: Record<string, (d: Record<string, unknown>) => void> = {
      'data-pi-message-start': (d) => {
        const role = d.role
        if (role !== 'user' && role !== 'assistant') return
        const text = typeof d.text === 'string' ? d.text : ''
        updatePiMessages((items) => {
          const existing = items.find((item) => item.id === piMessageId)
          if (!existing) return [...items, { id: piMessageId, role, parts: text ? [{ type: 'text' as const, text }] : [] }]
          if (!text || (existing.parts ?? []).some((part) => part.type === 'text' && part.text)) return items
          return items.map((item) => item.id === piMessageId
            ? { ...item, role, parts: [...(item.parts ?? []), { type: 'text' as const, text }] }
            : item)
        })
      },
      'data-pi-text-start': (d) => {
        const partId = typeof d.partId === 'string' ? d.partId : '0'
        updatePiMessages((items) => {
          const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
          return existing.map((item) => item.id === piMessageId
            ? { ...item, parts: item.parts?.some((p) => p.type === 'text' && (p as { id?: string }).id === partId) ? item.parts : [...(item.parts ?? []), { type: 'text' as const, id: partId, text: '' }] }
            : item)
        })
      },
      'data-pi-text-delta': (d) => {
        const partId = typeof d.partId === 'string' ? d.partId : '0'
        const delta = typeof d.delta === 'string' ? d.delta : ''
        if (!delta) return
        queueBufferedDelta({ kind: 'text', messageId: piMessageId, partId, delta })
      },
      'data-pi-text-end': (d) => {
        const partId = typeof d.partId === 'string' ? d.partId : '0'
        const text = typeof d.text === 'string' ? d.text : ''
        if (!text) return
        updatePiMessages((items) => {
          const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
          return existing.map((item) => {
            if (item.id !== piMessageId) return item
            let found = false
            const parts = (item.parts ?? []).map((p) => {
              if (p.type === 'text' && ((p as { id?: string }).id ?? partId) === partId) {
                found = true
                const current = p.text ?? ''
                return !current || (text.startsWith(current) && text.length > current.length)
                  ? { ...p, text }
                  : p
              }
              return p
            })
            return { ...item, parts: (found ? parts : [...parts, { type: 'text' as const, id: partId, text }]) as UIMessage['parts'] }
          })
        })
      },
      'data-pi-reasoning-start': (d) => {
        const partId = typeof d.partId === 'string' ? d.partId : '0'
        updatePiMessages((items) => {
          const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
          return existing.map((item) => item.id === piMessageId
            ? { ...item, parts: item.parts?.some((p) => p.type === 'reasoning' && (p as { id?: string }).id === partId) ? item.parts : [...(item.parts ?? []), { type: 'reasoning' as const, id: partId, text: '' }] }
            : item)
        })
      },
      'data-pi-reasoning-delta': (d) => {
        const partId = typeof d.partId === 'string' ? d.partId : '0'
        const delta = typeof d.delta === 'string' ? d.delta : ''
        if (!delta) return
        queueBufferedDelta({ kind: 'reasoning', messageId: piMessageId, partId, delta })
      },
      'data-pi-tool-call-end': (d) => {
        const toolCallId = typeof d.toolCallId === 'string' ? d.toolCallId : undefined
        const toolName = typeof d.toolName === 'string' ? d.toolName : undefined
        if (!toolCallId || !toolName) return
        updatePiMessages((items) => {
          const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
          return existing.map((item) => item.id === piMessageId
            ? { ...item, parts: [...(item.parts ?? []).filter((p) => (p as { toolCallId?: string }).toolCallId !== toolCallId), { type: `tool-${toolName}`, toolCallId, state: 'input-available', input: d.input }] as UIMessage['parts'] }
            : item)
        })
      },
      'data-pi-tool-result': (d) => {
        const toolCallId = typeof d.toolCallId === 'string' ? d.toolCallId : undefined
        if (!toolCallId) return
        updatePiMessages((items) => items.map((item) => item.id === piMessageId
          ? { ...item, parts: (item.parts ?? []).map((p) => (p as { toolCallId?: string }).toolCallId === toolCallId ? { ...p, state: d.isError ? 'output-error' : 'output-available', output: d.output } : p) as UIMessage['parts'] }
          : item))
      },
      'data-pi-message-end': (d) => {
        const text = typeof d.text === 'string' ? d.text : ''
        if (!text) return
        // Fallback/final emission. Append only if no text exists; otherwise
        // let the final full text repair a partial live stream when it is a
        // strict extension of the current single text part. This preserves the
        // duplicate guard for multi-part messages while recovering from missed
        // or coalesced deltas.
        updatePiMessages((items) => items.map((item) => {
          if (item.id !== piMessageId) return item
          const textParts = (item.parts ?? []).filter((p) => p.type === 'text')
          const nonEmptyTextParts = textParts.filter((p) => p.text)
          if (nonEmptyTextParts.length === 0) {
            return { ...item, parts: [...(item.parts ?? []), { type: 'text' as const, text }] }
          }
          if (textParts.length === 1) {
            const current = textParts[0]?.text ?? ''
            if (text.startsWith(current) && text.length > current.length) {
              return {
                ...item,
                parts: (item.parts ?? []).map((p) => p === textParts[0] ? { ...p, text } : p) as UIMessage['parts'],
              }
            }
          }
          return item
        }))
      },
    }
    if (typed.type) handlers[typed.type]?.(data)
  }, [flushBufferedDeltas, queueBufferedDelta, updatePiMessages])

  useEffect(() => {
    if (status !== 'ready' || piMessagesRef.current.length > 0 || messages.length === 0) return
    if (rebuildPiMessagesFromDataParts(messages).length > 0) return
    updatePiMessages(() => messages)
  }, [messages, status, updatePiMessages])

  useEffect(() => {
    // During an active stream, `handleData` is the smooth path: it applies
    // incremental text/tool deltas as they arrive. Rebuilding from the AI SDK
    // message envelope while the stream is still moving can replace that live
    // projection with a lagging/full snapshot, which reads as "a few chars…
    // then a big jump" in the UI. Rebuild only once the turn has settled
    // (or for already-persisted messages loaded while ready).
    if (status !== 'ready') return
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    if (rebuilt.length > 0) updatePiMessages((current) => mergeRebuiltPiMessages(current, rebuilt))
  }, [messages, status, updatePiMessages])

  const prevPiPersistStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevPiPersistStatusRef.current
    prevPiPersistStatusRef.current = status
    if (status !== 'ready') return
    if (prev !== 'streaming' && prev !== 'submitted') return
    if (!sessionId || piMessages.length === 0) return
    const canonicalMessages = rebuildPiMessagesFromDataParts(piMessages)
    const messagesToPersist = canonicalMessages.length > 0 ? mergeRebuiltPiMessages(piMessages, canonicalMessages) : piMessages
    const stripped = messagesToPersist.map((msg) => ({
      ...msg,
      parts: msg.parts?.filter((part: unknown) => {
        const p = part as Record<string, unknown>
        return !(typeof p.type === 'string' && p.type.startsWith('data-pi-'))
      }).map((part: unknown) => {
        const p = part as Record<string, unknown>
        if (p.type === 'file' && typeof p.url === 'string' && p.url.startsWith('data:')) return { ...p, url: '' }
        if (p.type === 'text' && 'id' in p) {
          const rest = { ...p }
          delete rest.id
          return rest
        }
        return part
      }),
    }))
    fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/messages`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...requestHeaders },
      body: JSON.stringify({ messages: stripped }),
    }).catch(() => {})
  }, [sessionId, status, piMessages, requestHeaders])

  return { piMessages, handleData }
}
