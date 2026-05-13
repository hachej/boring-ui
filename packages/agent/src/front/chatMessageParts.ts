import type { FileUIPart, UIMessage } from 'ai'

export interface ReasoningPartView {
  text: string
  state: 'streaming' | 'done'
}

export function isTextPart(part: UIMessage['parts'][number]): part is Extract<UIMessage['parts'][number], { type: 'text' }> {
  return part.type === 'text'
}

export function isBlankTextPart(part: UIMessage['parts'][number]): boolean {
  return isTextPart(part) && part.text.trim().length === 0
}

export function isFilePart(part: UIMessage['parts'][number]): part is FileUIPart {
  return part.type === 'file'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null
  return value as Record<string, unknown>
}

export function getReasoningPart(part: UIMessage['parts'][number]): ReasoningPartView | null {
  const record = asRecord(part)
  if (!record || record.type !== 'reasoning') return null
  const textCandidate = record.text ?? record.content
  if (typeof textCandidate !== 'string' || textCandidate.length === 0) return null
  const stateCandidate = record.state
  return {
    text: textCandidate,
    state: stateCandidate === 'streaming' ? 'streaming' : 'done',
  }
}
