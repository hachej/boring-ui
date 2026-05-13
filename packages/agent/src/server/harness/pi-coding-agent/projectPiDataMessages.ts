import type { UIMessage } from '../../../shared/message'

type PiDataPart = { type?: string; data?: Record<string, unknown> }

/**
 * Temporary pi-owned history projection for the adapter-owned-history path.
 *
 * Generic chat routes should not learn pi's wire DTOs. This helper keeps the
 * current `data-pi-*` persistence compatibility isolated until GH #19 moves
 * client + server projection into one platform-safe shared helper.
 */
export function projectPiDataMessages(messages: UIMessage[]): UIMessage[] {
  const dataParts = messages.flatMap((message) => message.parts ?? []).filter((part) => {
    const type = (part as { type?: unknown }).type
    return typeof type === 'string' && type.startsWith('data-pi-')
  }) as PiDataPart[]
  if (dataParts.length === 0) return messages
  const projected: UIMessage[] = []
  const ensureMessage = (id: string, role: 'user' | 'assistant', text = ''): UIMessage => {
    let msg = projected.find((item) => item.id === id)
    if (!msg) {
      msg = { id, role, parts: text ? [{ type: 'text' as const, text }] : [] }
      projected.push(msg)
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
      if (!msg.parts?.some((p) => p.type === 'text')) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text: '' }]
    } else if (part.type === 'data-pi-text-delta') {
      const msg = ensureMessage(messageId, 'assistant')
      const delta = typeof data.delta === 'string' ? data.delta : ''
      const index = (msg.parts ?? []).findIndex((p) => p.type === 'text')
      if (index >= 0) {
        msg.parts = (msg.parts ?? []).map((p, i) => i === index && p.type === 'text' ? { ...p, text: `${p.text}${delta}` } : p)
      } else {
        msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text: delta }]
      }
    } else if (part.type === 'data-pi-text-end' || (part.type === 'data-pi-message-end' && data.role === 'assistant')) {
      const msg = ensureMessage(messageId, 'assistant')
      const text = typeof data.text === 'string' ? data.text : ''
      if (text && !(msg.parts ?? []).some((p) => p.type === 'text' && p.text)) msg.parts = [...(msg.parts ?? []), { type: 'text' as const, text }]
    }
  }
  if (projected.length === 0) return messages
  const projectedIds = new Set(projected.map((message) => message.id))
  const preserved = messages.filter((message) => {
    if (projectedIds.has(message.id)) return false
    return !(message.parts ?? []).some((part) => {
      const type = (part as { type?: unknown }).type
      return typeof type === 'string' && type.startsWith('data-pi-')
    })
  })
  return [...preserved, ...projected]
}
