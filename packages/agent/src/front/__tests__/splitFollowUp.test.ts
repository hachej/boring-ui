import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { splitFollowUp, splitFollowUpForDisplay } from '../splitFollowUp'

let idSeq = 0
const nextId = () => `id-${++idSeq}`

function text(content: string) {
  return { type: 'text' as const, text: content, state: 'done' as const }
}
function marker() {
  return { type: 'data-followup-consumed' as string }
}

function user(id: string, content: string): UIMessage {
  return { id, role: 'user', parts: [text(content)] } as UIMessage
}
function assistant(id: string, parts: unknown[]): UIMessage {
  return { id, role: 'assistant', parts: parts as UIMessage['parts'] } as UIMessage
}

beforeEach(() => { idSeq = 0 })

describe('splitFollowUp', () => {
  it('splits the assistant message at the marker and inserts user turn', () => {
    const msgs: UIMessage[] = [
      user('u1', 'hi'),
      assistant('a1', [text('Hi there!'), marker(), text('list files response')]),
    ]
    const result = splitFollowUp(msgs, { text: 'list files', files: [] }, nextId)

    expect(result).toHaveLength(4)
    expect(result[0]).toMatchObject({ role: 'user', id: 'u1' })
    expect(result[1]).toMatchObject({ role: 'assistant', id: 'a1' }) // asst1 keeps original id
    expect(result[1].parts).toHaveLength(1)
    expect(result[1].parts[0]).toMatchObject({ type: 'text', text: 'Hi there!' })

    expect(result[2]).toMatchObject({ role: 'user' })
    expect(result[2].parts.some((p: unknown) => (p as { type?: string }).type === 'text' && (p as { text?: string }).text === 'list files')).toBe(true)

    expect(result[3]).toMatchObject({ role: 'assistant' })
    expect(result[3].id).not.toBe('a1') // asst2 gets a new id
    expect(result[3].parts).toHaveLength(1)
    expect(result[3].parts[0]).toMatchObject({ type: 'text', text: 'list files response' })
  })

  it('strips the data-followup-consumed marker from both result messages', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('answer'), marker(), text('follow-up answer')]),
    ]
    const result = splitFollowUp(msgs, { text: 'follow-up', files: [] }, nextId)
    const allParts = result.flatMap((m) => m.parts ?? [])
    expect(allParts.some((p) => (p as { type?: string }).type === 'data-followup-consumed')).toBe(false)
  })

  it('splits at the first namespaced follow-up part when data marker is not retained in message state', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('turn1'), { ...text('turn2'), id: 'turn-1:0' }]),
    ]
    const result = splitFollowUp(msgs, { text: 'follow-up', files: [] }, nextId)

    expect(result).toHaveLength(4)
    expect(result[1].parts).toEqual([text('turn1')])
    expect(result[2]).toMatchObject({ role: 'user' })
    expect(result[3].parts).toEqual([{ ...text('turn2'), id: 'turn-1:0' }])
  })

  it('fallback: prints user message before the last assistant when no boundary is retained', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('response without marker')]),
    ]
    const result = splitFollowUp(msgs, { text: 'follow-up', files: [] }, nextId)

    expect(result).toHaveLength(3)
    expect(result[1]).toMatchObject({ role: 'user' })
    expect(result[1].parts[0]).toMatchObject({ type: 'text', text: 'follow-up' })
    expect(result[2]).toMatchObject({ role: 'assistant', id: 'a1' })
  })

  it('splits before the last text part when AI SDK drops marker and ids', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('first answer'), text('follow-up answer')]),
    ]
    const result = splitFollowUp(msgs, { text: 'follow-up', files: [] }, nextId)

    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(result[1].parts).toEqual([text('first answer')])
    expect(result[2].parts[0]).toMatchObject({ type: 'text', text: 'follow-up' })
    expect(result[3].parts).toEqual([text('follow-up answer')])
  })

  it('preserves messages before and after the target when multiple messages exist', () => {
    const before = user('u0', 'earlier')
    const after = user('u2', 'later')
    const msgs: UIMessage[] = [
      before,
      user('u1', 'hi'),
      assistant('a1', [text('turn1'), marker(), text('turn2')]),
      after,
    ]
    const result = splitFollowUp(msgs, { text: 'q2', files: [] }, nextId)

    expect(result).toHaveLength(6)
    expect(result[0]).toBe(before)
    expect(result[result.length - 1]).toBe(after)
  })

  it('handles empty turn1Parts when marker is the first part', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [marker(), text('only-second-turn')]),
    ]
    const result = splitFollowUp(msgs, { text: 'q2', files: [] }, nextId)

    expect(result[1].parts).toHaveLength(0) // asst1 has no parts
    expect(result[3].parts).toHaveLength(1)
    expect(result[3].parts[0]).toMatchObject({ text: 'only-second-turn' })
  })

  it('handles empty turn2Parts when marker is the last part', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('only-first-turn'), marker()]),
    ]
    const result = splitFollowUp(msgs, { text: 'q2', files: [] }, nextId)

    expect(result[1].parts).toHaveLength(1)
    expect(result[1].parts[0]).toMatchObject({ text: 'only-first-turn' })
    expect(result[3].parts).toHaveLength(0) // asst2 has no parts
  })

  it('includes file parts in the injected user message', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('r'), marker(), text('r2')]),
    ]
    const filePart = { type: 'file' as const, url: 'data:image/png;base64,abc', mediaType: 'image/png', filename: 'shot.png' }
    const result = splitFollowUp(msgs, { text: 'with file', files: [filePart as any] }, nextId)

    const injectedUser = result[2]
    expect(injectedUser.parts.some((p: unknown) => (p as { type?: string }).type === 'file')).toBe(true)
    expect(injectedUser.parts.some((p: unknown) => (p as { text?: string }).text === 'with file')).toBe(true)
  })

  it('live display uses pending draft when consumed marker callback state was lost', () => {
    const msgs: UIMessage[] = [
      user('u1', 'hi'),
      assistant('a1', [text('hello'), { ...text('files listed'), id: 'turn-1:0' }]),
    ]
    const result = splitFollowUpForDisplay(
      msgs,
      null,
      { text: 'list file', files: [] },
      { userId: 'queued-user', assistantId: 'followup-assistant' },
    )

    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(result[2]).toMatchObject({ id: 'queued-user', role: 'user' })
    expect(result[2].parts.some((p: unknown) => (p as { text?: string }).text === 'list file')).toBe(true)
    expect(result[3]).toMatchObject({ id: 'followup-assistant', role: 'assistant' })
  })

  it('live display does not move pending bubble before follow-up text starts streaming', () => {
    const msgs: UIMessage[] = [
      user('u1', 'hi'),
      assistant('a1', [text('hello')]),
    ]
    const result = splitFollowUpForDisplay(
      msgs,
      null,
      { text: 'list file', files: [] },
      { userId: 'queued-user', assistantId: 'followup-assistant' },
    )

    expect(result).toBe(msgs)
  })

  it('assigns distinct ids to asst1 (original), user message, and asst2 (new)', () => {
    const msgs: UIMessage[] = [
      user('u1', 'q'),
      assistant('a1', [text('r1'), marker(), text('r2')]),
    ]
    const result = splitFollowUp(msgs, { text: 'q2', files: [] }, nextId)

    const ids = result.map((m) => m.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length) // all ids are distinct
    expect(result[1].id).toBe('a1') // asst1 keeps original
  })
})
