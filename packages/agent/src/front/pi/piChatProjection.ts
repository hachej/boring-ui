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
      // Check for the specific partId (not just any text part) to avoid
      // adding duplicate text when a different partId already has content.
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      if (text && !(msg.parts ?? []).some((p) => p.type === 'text' && (p as { id?: string }).id === partId && p.text)) {
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

  const updatePiMessages = useCallback((updater: (items: UIMessage[]) => UIMessage[]) => {
    const next = updater(piMessagesRef.current)
    piMessagesRef.current = next
    setPiMessages(next)
  }, [])

  const previousSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    piMessagesRef.current = []
    setPiMessages([])
  }, [sessionId])

  const handleData = useCallback((part: unknown) => {
    const typed = part as { type?: string; data?: Record<string, unknown> }
    const data = typed.data ?? {}
    const piMessageId = typeof data.messageId === 'string' ? data.messageId : undefined
    if (typed.type === 'data-pi-message-start' && piMessageId && (data.role === 'user' || data.role === 'assistant')) {
      const role = data.role as 'user' | 'assistant'
      const text = typeof data.text === 'string' ? data.text : ''
      updatePiMessages((items) => {
        const existing = items.find((item) => item.id === piMessageId)
        if (!existing) return [...items, { id: piMessageId, role, parts: text ? [{ type: 'text' as const, text }] : [] }]
        if (!text || (existing.parts ?? []).some((part) => part.type === 'text' && part.text)) return items
        return items.map((item) => item.id === piMessageId
          ? { ...item, role, parts: [...(item.parts ?? []), { type: 'text' as const, text }] }
          : item)
      })
    } else if (typed.type === 'data-pi-text-start' && piMessageId) {
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => item.id === piMessageId
          ? { ...item, parts: item.parts?.some((p) => p.type === 'text' && (p as { id?: string }).id === partId) ? item.parts : [...(item.parts ?? []), { type: 'text' as const, id: partId, text: '' }] }
          : item)
      })
    } else if (typed.type === 'data-pi-text-delta' && piMessageId) {
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      const delta = typeof data.delta === 'string' ? data.delta : ''
      if (delta) updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => {
          if (item.id !== piMessageId) return item
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
      })
    } else if (typed.type === 'data-pi-text-end' && piMessageId) {
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      const text = typeof data.text === 'string' ? data.text : ''
      if (text) updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => {
          if (item.id !== piMessageId) return item
          let found = false
          const parts = (item.parts ?? []).map((p) => {
            if (p.type === 'text' && ((p as { id?: string }).id ?? partId) === partId) {
              found = true
              return p.text ? p : { ...p, text }
            }
            return p
          })
          return { ...item, parts: (found ? parts : [...parts, { type: 'text' as const, id: partId, text }]) as UIMessage['parts'] }
        })
      })
    } else if (typed.type === 'data-pi-reasoning-start' && piMessageId) {
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => item.id === piMessageId
          ? { ...item, parts: item.parts?.some((p) => p.type === 'reasoning' && (p as { id?: string }).id === partId) ? item.parts : [...(item.parts ?? []), { type: 'reasoning' as const, id: partId, text: '' }] }
          : item)
      })
    } else if (typed.type === 'data-pi-reasoning-delta' && piMessageId) {
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      const delta = typeof data.delta === 'string' ? data.delta : ''
      if (delta) updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => {
          if (item.id !== piMessageId) return item
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
      })
    } else if (typed.type === 'data-pi-tool-call-end' && piMessageId) {
      const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
      const toolName = typeof data.toolName === 'string' ? data.toolName : undefined
      if (toolCallId && toolName) updatePiMessages((items) => {
        const existing = items.some((item) => item.id === piMessageId) ? items : [...items, { id: piMessageId, role: 'assistant' as const, parts: [] }]
        return existing.map((item) => item.id === piMessageId
          ? { ...item, parts: [...(item.parts ?? []).filter((p) => (p as { toolCallId?: string }).toolCallId !== toolCallId), { type: `tool-${toolName}`, toolCallId, state: 'input-available', input: data.input }] as UIMessage['parts'] }
          : item)
      })
    } else if (typed.type === 'data-pi-tool-result' && piMessageId) {
      const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined
      if (toolCallId) updatePiMessages((items) => items.map((item) => item.id === piMessageId
        ? { ...item, parts: (item.parts ?? []).map((p) => (p as { toolCallId?: string }).toolCallId === toolCallId ? { ...p, state: data.isError ? 'output-error' : 'output-available', output: data.output } : p) as UIMessage['parts'] }
        : item))
    } else if (typed.type === 'data-pi-message-end' && piMessageId) {
      const text = typeof data.text === 'string' ? data.text : ''
      const partId = typeof data.partId === 'string' ? data.partId : '0'
      if (text) updatePiMessages((items) => items.map((item) => item.id === piMessageId && !(item.parts ?? []).some((p) => p.type === 'text' && (p as { id?: string }).id === partId && p.text)
        ? { ...item, parts: [...(item.parts ?? []), { type: 'text' as const, text }] }
        : item))
    }
  }, [updatePiMessages])

  useEffect(() => {
    if (status !== 'ready' || piMessagesRef.current.length > 0 || messages.length === 0) return
    if (rebuildPiMessagesFromDataParts(messages).length > 0) return
    updatePiMessages(() => messages)
  }, [messages, status, updatePiMessages])

  useEffect(() => {
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    if (rebuilt.length > 0) updatePiMessages((current) => mergeRebuiltPiMessages(current, rebuilt))
  }, [messages, updatePiMessages])

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
    try {
      globalThis.localStorage?.setItem(`boring-agent:messages:${sessionId}`, JSON.stringify(stripped))
    } catch { /* ignore */ }
  }, [sessionId, status, piMessages, requestHeaders])

  return { piMessages, handleData }
}
