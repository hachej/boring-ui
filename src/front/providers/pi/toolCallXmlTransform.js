const TOOL_NAME_ALIASES = new Map([
  ['list_files', 'list_dir'],
  ['list_directory', 'list_dir'],
  ['exec_bash', 'bash'],
])

const SUPPORTED_TOOL_NAMES = new Set([
  'read_file',
  'write_file',
  'list_files',
  'list_directory',
  'list_dir',
  'bash',
  'exec_bash',
  'tool_use',
])

const XML_BLOCK_PATTERN = /<(read_file|write_file|list_files|list_directory|list_dir|bash|exec_bash)(?:\s[^>]*)?>[\s\S]*?<\/\1>|<tool_use(?:\s[^>]*)?>[\s\S]*?<\/tool_use>/gi
const TOOL_XML_TAG_PATTERN = /<\/?(read_file|write_file|list_files|list_directory|list_dir|bash|exec_bash|tool_use)\b[^>]*>/gi
const XML_ATTR_PATTERN = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(['"])([\s\S]*?)\2/g
const XML_FIELD_PATTERN = /<([A-Za-z_][A-Za-z0-9_.-]*)>([\s\S]*?)<\/\1>/g

const hashString = (value) => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
  }
  return Math.abs(hash >>> 0).toString(36)
}

const decodeXmlText = (value) => {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const normalizeToolName = (value) => {
  const lowered = String(value || '').trim().toLowerCase()
  if (!lowered) return ''
  return TOOL_NAME_ALIASES.get(lowered) || lowered
}

const parseAttributes = (tagText) => {
  const attrs = {}
  if (!tagText) return attrs
  XML_ATTR_PATTERN.lastIndex = 0
  let match = XML_ATTR_PATTERN.exec(tagText)
  while (match) {
    attrs[match[1]] = decodeXmlText(match[3]).trim()
    match = XML_ATTR_PATTERN.exec(tagText)
  }
  return attrs
}

const parseToolFields = (body) => {
  const fields = {}
  if (!body) return fields

  XML_FIELD_PATTERN.lastIndex = 0
  let match = XML_FIELD_PATTERN.exec(body)
  while (match) {
    const key = String(match[1] || '').trim().toLowerCase()
    if (!key) {
      match = XML_FIELD_PATTERN.exec(body)
      continue
    }

    const value = decodeXmlText(match[2] || '')
    fields[key] = value.trim()
    match = XML_FIELD_PATTERN.exec(body)
  }

  return fields
}

const extractSummary = (toolName, fields) => {
  const path = String(fields.path || fields.file || fields.filename || fields.target || '').trim()
  const command = String(fields.command || fields.cmd || '').trim()

  if (toolName === 'read_file') {
    return path ? `Read ${path}` : 'Read file'
  }
  if (toolName === 'write_file') {
    return path ? `Wrote ${path}` : 'Wrote file'
  }
  if (toolName === 'list_dir') {
    return `Listed files in ${path || '.'}`
  }
  if (toolName === 'bash') {
    return command ? `Ran command: ${command}` : 'Ran command'
  }
  if (toolName === 'xml_parse_error') {
    return 'Malformed tool payload hidden'
  }
  return `Ran ${toolName}`
}

const extractOutput = (toolName, fields) => {
  const content = String(fields.output || fields.result || fields.stdout || fields.stderr || '').trim()
  if (content) return content

  if (toolName === 'read_file') {
    const value = String(fields.content || '').trim()
    if (value) return value
  }

  return extractSummary(toolName, fields)
}

const createToolCall = (toolName, fields, rawBlock, keyBase, timestamp) => {
  const normalizedToolName = normalizeToolName(toolName)
  if (!normalizedToolName || normalizedToolName === 'tool_use') return null

  const id = `xml-tool-${hashString(`${keyBase}:${normalizedToolName}:${rawBlock}`)}`
  return {
    toolCall: {
      type: 'toolCall',
      id,
      name: normalizedToolName,
      arguments: fields,
    },
    toolResult: {
      role: 'toolResult',
      toolCallId: id,
      toolName: normalizedToolName,
      isError: false,
      content: [{ type: 'text', text: extractOutput(normalizedToolName, fields) }],
      details: {
        summary: extractSummary(normalizedToolName, fields),
        source: 'xml-tool-transform',
      },
      timestamp,
    },
  }
}

const parseXmlToolBlock = (blockText, keyBase, timestamp) => {
  const text = String(blockText || '')
  const openTagMatch = text.match(/^<([A-Za-z_][A-Za-z0-9_-]*)([^>]*)>/)
  if (!openTagMatch) return null

  const rawTagName = String(openTagMatch[1] || '').trim().toLowerCase()
  if (!SUPPORTED_TOOL_NAMES.has(rawTagName)) return null

  const attrs = parseAttributes(openTagMatch[2] || '')
  const closeTagPattern = new RegExp(`</${rawTagName}>$`, 'i')
  const body = text
    .replace(/^<[^>]+>/, '')
    .replace(closeTagPattern, '')

  if (rawTagName === 'tool_use') {
    const namedTool = normalizeToolName(attrs.name || '')
    if (!namedTool) return null
    return createToolCall(namedTool, parseToolFields(body), text, keyBase, timestamp)
  }

  return createToolCall(rawTagName, parseToolFields(body), text, keyBase, timestamp)
}

const createParseErrorTool = (snippet, keyBase, timestamp) => {
  const id = `xml-tool-${hashString(`${keyBase}:xml-parse-error:${snippet}`)}`
  return {
    toolCall: {
      type: 'toolCall',
      id,
      name: 'xml_parse_error',
      arguments: {
        snippet: String(snippet || '').trim().slice(0, 400),
      },
    },
    toolResult: {
      role: 'toolResult',
      toolCallId: id,
      toolName: 'xml_parse_error',
      isError: true,
      content: [{ type: 'text', text: 'Malformed XML tool payload hidden from chat output.' }],
      details: {
        source: 'xml-tool-transform',
      },
      timestamp,
    },
  }
}

const toTextChunk = (text) => ({ type: 'text', text })

const cleanDanglingXmlTags = (text) => {
  const rawText = String(text || '')
  const cleaned = rawText.replace(TOOL_XML_TAG_PATTERN, '')
  return {
    text: cleaned,
    changed: cleaned !== rawText,
  }
}

export const transformAssistantXmlMessage = (message) => {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) {
    return { message, toolResults: [], changed: false }
  }

  let changed = false
  let transformedAny = false
  let malformedDetected = false
  const nextContent = []
  const toolResults = []

  message.content.forEach((chunk, chunkIndex) => {
    if (!chunk || chunk.type !== 'text' || typeof chunk.text !== 'string') {
      nextContent.push(chunk)
      return
    }

    const input = chunk.text
    XML_BLOCK_PATTERN.lastIndex = 0

    let cursor = 0
    let match = XML_BLOCK_PATTERN.exec(input)
    let matchedAny = false

    while (match) {
      matchedAny = true
      const before = input.slice(cursor, match.index)
      const cleanedBefore = cleanDanglingXmlTags(before)
      if (cleanedBefore.changed) {
        malformedDetected = true
        changed = true
      }
      if (cleanedBefore.text) nextContent.push(toTextChunk(cleanedBefore.text))

      const block = match[0]
      const parsed = parseXmlToolBlock(block, `${message.timestamp || '0'}:${chunkIndex}:${match.index}`, message.timestamp || Date.now())

      if (parsed) {
        nextContent.push(parsed.toolCall)
        toolResults.push(parsed.toolResult)
        changed = true
        transformedAny = true
      } else {
        malformedDetected = true
        changed = true
      }

      cursor = match.index + block.length
      match = XML_BLOCK_PATTERN.exec(input)
    }

    const tail = input.slice(cursor)
    const cleanedTail = cleanDanglingXmlTags(tail)
    if (cleanedTail.changed) {
      malformedDetected = true
      changed = true
    }

    if (matchedAny) {
      if (cleanedTail.text) nextContent.push(toTextChunk(cleanedTail.text))
      return
    }

    if (cleanedTail.changed) {
      if (cleanedTail.text) nextContent.push(toTextChunk(cleanedTail.text))
      return
    }

    nextContent.push(chunk)
  })

  if (malformedDetected) {
    const parseError = createParseErrorTool(
      message.content
        .filter((chunk) => chunk?.type === 'text')
        .map((chunk) => chunk.text)
        .join('\n'),
      `${message.timestamp || '0'}:parse-error`,
      message.timestamp || Date.now(),
    )
    nextContent.push(parseError.toolCall)
    toolResults.push(parseError.toolResult)
    changed = true
    transformedAny = true
  }

  if (!changed) {
    return { message, toolResults: [], changed: false }
  }

  const finalContent = nextContent.filter((chunk) => {
    if (!chunk) return false
    if (chunk.type !== 'text') return true
    return typeof chunk.text === 'string' && chunk.text.length > 0
  })

  // Preserve non-empty assistant messages in case the payload was pure XML.
  if (!finalContent.some((chunk) => chunk?.type === 'text' || chunk?.type === 'toolCall')) {
    finalContent.push(toTextChunk(transformedAny ? '' : String('')))
  }

  return {
    message: {
      ...message,
      content: finalContent,
    },
    toolResults,
    changed: true,
  }
}

export const normalizeXmlToolMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: Array.isArray(messages) ? messages : [], changed: false }
  }

  const existingResultIds = new Set(
    messages
      .filter((message) => message?.role === 'toolResult' && message?.toolCallId)
      .map((message) => String(message.toolCallId)),
  )

  const nextMessages = []
  let changed = false

  for (const message of messages) {
    if (!message || message.role !== 'assistant') {
      nextMessages.push(message)
      continue
    }

    const transformed = transformAssistantXmlMessage(message)
    if (!transformed.changed) {
      nextMessages.push(message)
      continue
    }

    changed = true
    nextMessages.push(transformed.message)

    for (const toolResult of transformed.toolResults) {
      const resultId = String(toolResult?.toolCallId || '')
      if (!resultId || existingResultIds.has(resultId)) continue
      existingResultIds.add(resultId)
      nextMessages.push(toolResult)
    }
  }

  return {
    messages: changed ? nextMessages : messages,
    changed,
  }
}
