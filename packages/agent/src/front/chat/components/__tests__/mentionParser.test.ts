import { describe, expect, it } from 'vitest'
import { parseMentions } from '../mentionParser'

describe('parseMentions', () => {
  it('detects available slash commands in prose', () => {
    const segments = parseMentions('Try /help or /reload.', ['help', 'reload'])

    expect(segments).toEqual([
      { type: 'text', content: 'Try ' },
      { type: 'mention', content: '/help', mention: { kind: 'slash-command', value: '/help', label: '/help' } },
      { type: 'text', content: ' or ' },
      { type: 'mention', content: '/reload', mention: { kind: 'slash-command', value: '/reload', label: '/reload' } },
      { type: 'text', content: '.' },
    ])
  })

  it('ignores slash-like text that is not an available command', () => {
    const segments = parseMentions('Open https://example.com/foo and /missing.', ['help'])

    expect(segments).toEqual([{ type: 'text', content: 'Open https://example.com/foo and /missing.' }])
  })

  it('keeps parsing future mention kinds', () => {
    const segments = parseMentions('Inspect @packages/agent and !design-impeccable.', ['help'])

    expect(segments).toEqual([
      { type: 'text', content: 'Inspect ' },
      { type: 'mention', content: '@packages/agent', mention: { kind: 'file-path', value: 'packages/agent', label: '@packages/agent' } },
      { type: 'text', content: ' and ' },
      { type: 'mention', content: '!design-impeccable', mention: { kind: 'skill', value: '!design-impeccable', label: '!design-impeccable' } },
      { type: 'text', content: '.' },
    ])
  })

  it('detects plain workspace file paths and keeps line suffixes out of the open path', () => {
    const segments = parseMentions('Open packages/agent/src/front/chat/PiChatPanel.tsx:42 please.', ['help'])

    expect(segments).toEqual([
      { type: 'text', content: 'Open ' },
      { type: 'mention', content: 'packages/agent/src/front/chat/PiChatPanel.tsx:42', mention: { kind: 'file-path', value: 'packages/agent/src/front/chat/PiChatPanel.tsx:42', label: 'packages/agent/src/front/chat/PiChatPanel.tsx:42' } },
      { type: 'text', content: ' please.' },
    ])
  })

  it('does not treat URLs as workspace file paths', () => {
    const segments = parseMentions('Read https://example.com/packages/agent/src/file.ts.', ['help'])

    expect(segments).toEqual([{ type: 'text', content: 'Read https://example.com/packages/agent/src/file.ts.' }])
  })
})
