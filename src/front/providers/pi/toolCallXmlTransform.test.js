import { describe, expect, it } from 'vitest'
import { normalizeXmlToolMessages, transformAssistantXmlMessage } from './toolCallXmlTransform'

const assistantMessage = (text) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  api: 'anthropic',
  provider: 'anthropic',
  model: 'claude',
  timestamp: 1710000000000,
})

describe('transformAssistantXmlMessage', () => {
  it('converts supported XML tool tags into tool calls and hides raw XML', () => {
    const message = assistantMessage(
      'Starting...\n<write_file><path>hello.py</path><content>print(42)</content></write_file>\nDone.',
    )

    const result = transformAssistantXmlMessage(message)

    expect(result.changed).toBe(true)
    expect(result.message.content.some((chunk) => chunk.type === 'toolCall')).toBe(true)
    expect(result.toolResults).toHaveLength(1)
    expect(result.toolResults[0].toolName).toBe('write_file')

    const joinedText = result.message.content
      .filter((chunk) => chunk.type === 'text')
      .map((chunk) => chunk.text)
      .join('\n')
    expect(joinedText).not.toContain('<write_file>')
    expect(joinedText).not.toContain('</write_file>')
  })

  it('parses tool_use wrapper tags and normalizes tool aliases', () => {
    const message = assistantMessage('<tool_use name="bash"><command>ls -la</command></tool_use>')
    const result = transformAssistantXmlMessage(message)

    const toolCall = result.message.content.find((chunk) => chunk.type === 'toolCall')
    expect(toolCall).toBeTruthy()
    expect(toolCall.name).toBe('bash')
    expect(toolCall.arguments.command).toBe('ls -la')
    expect(result.toolResults[0].toolName).toBe('bash')
  })

  it('creates parse-error card for malformed XML snippets', () => {
    const message = assistantMessage('<write_file><path>broken.txt</path>')
    const result = transformAssistantXmlMessage(message)

    expect(result.changed).toBe(true)
    const parseError = result.message.content.find(
      (chunk) => chunk.type === 'toolCall' && chunk.name === 'xml_parse_error',
    )
    expect(parseError).toBeTruthy()
    expect(result.toolResults[0].isError).toBe(true)
  })
})

describe('normalizeXmlToolMessages', () => {
  it('inserts synthetic tool results after transformed assistant messages', () => {
    const input = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 },
      assistantMessage('<read_file><path>src/main.js</path></read_file>'),
    ]

    const normalized = normalizeXmlToolMessages(input)
    expect(normalized.changed).toBe(true)
    expect(normalized.messages[1].role).toBe('assistant')
    expect(normalized.messages[2].role).toBe('toolResult')
    expect(normalized.messages[2].toolName).toBe('read_file')
  })
})
