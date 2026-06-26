import { describe, it, expect } from 'vitest'
import type { BoringChatPart } from '../../../../shared/chat'
import { mergeFinalMessageParts } from '../piChatPartMerging'

const text = (id: string, value: string): BoringChatPart => ({ type: 'text', id, text: value })
const tool = (id: string, name: string): BoringChatPart => ({
  type: 'tool-call',
  id,
  toolName: name,
  state: 'output-available',
})

describe('mergeFinalMessageParts ordering', () => {
  it('preserves an interleaved tool → text → tool sequence (does not bucket tools together)', () => {
    const final: BoringChatPart[] = [
      tool('t1', 'bash'),
      text('m1', 'Now let me check the other file.'),
      tool('t2', 'read'),
      tool('t3', 'edit'),
    ]

    const merged = mergeFinalMessageParts([], final)

    // Regression: the old type-bucketing produced [t1, t2, t3, m1], which made
    // the later tools render in the group ABOVE the message.
    expect(merged.map((part) => part.id)).toEqual(['t1', 'm1', 't2', 't3'])
  })

  it('reconciles streaming parts with the final snapshot while keeping emitted order', () => {
    const streaming: BoringChatPart[] = [tool('t1', 'bash'), text('m1', 'partial')]
    const final: BoringChatPart[] = [
      tool('t1', 'bash'),
      text('m1', 'partial done'),
      tool('t2', 'read'),
    ]

    const merged = mergeFinalMessageParts(streaming, final)

    expect(merged.map((part) => part.id)).toEqual(['t1', 'm1', 't2'])
    const finalText = merged.find((part) => part.id === 'm1')
    expect(finalText?.type === 'text' && finalText.text).toBe('partial done')
  })

  it('keeps a plain reasoning → text turn in order', () => {
    const final: BoringChatPart[] = [
      { type: 'reasoning', id: 'r1', text: 'thinking', state: 'done' },
      text('m1', 'answer'),
    ]
    expect(mergeFinalMessageParts([], final).map((part) => part.id)).toEqual(['r1', 'm1'])
  })

  it('keeps text before its tools when the final snapshot rewrites the streaming text id', () => {
    // Live regression: the model streamed "Step 1…" text then 3 tools; the
    // final snapshot reuses the same text content under a new id. The merged
    // text must stay before the tools, not drop below them.
    const body = 'Step 1 — calling 3 tools:'
    const existing: BoringChatPart[] = [text('live', body), tool('bash', 'bash'), tool('read', 'read'), tool('grep', 'grep')]
    const final: BoringChatPart[] = [text('final-id', body), tool('bash', 'bash'), tool('read', 'read'), tool('grep', 'grep')]
    const merged = mergeFinalMessageParts(existing, final)
    expect(merged.map((part) => part.type)).toEqual(['text', 'tool-call', 'tool-call', 'tool-call'])
  })

  it('keeps reasoning interleaved between tool groups (think → tool → think → tool)', () => {
    const r2 = (id: string): BoringChatPart => ({ type: 'reasoning', id, text: id, state: 'done' })
    const seq: BoringChatPart[] = [r2('think1'), tool('a', 'bash'), r2('think2'), tool('b', 'read')]
    const merged = mergeFinalMessageParts(seq, seq)
    // Not collapsed into [reasoning, reasoning, tool, tool].
    expect(merged.map((part) => part.id)).toEqual(['think1', 'a', 'think2', 'b'])
  })
})
