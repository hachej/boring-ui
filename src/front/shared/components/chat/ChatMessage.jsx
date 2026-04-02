import React from 'react'
import { User, Sparkles } from 'lucide-react'

import TextBlock from './TextBlock'
import { renderToolPart } from './toolRenderers'
import './styles.css'
import { bridgeToolResultToArtifact } from '../../../layouts/chat/utils/toolArtifactBridge'

const HIDDEN_PROTOCOL_PARTS = new Set([
  'tool-input-start',
  'tool-input-delta',
  'tool-input-end',
  'stream-start',
  'response-metadata',
  'finish',
  'raw',
  'source',
])

const FILE_REFERENCE_PATTERN = /^(?!https?:\/\/)(?!file:\/\/)(?:\.{1,2}\/)?(?:[\w@.-]+\/)*[\w@.-]+\.[a-z0-9]{1,16}$/i

function detectFilePaths(text) {
  if (!text) return []
  const tokens = String(text).match(/\S+/g) || []
  const matches = tokens
    .map((token) => token.replace(/^[`([{<]+|[`)\]}>.,:;!?]+$/g, ''))
    .filter((path) => FILE_REFERENCE_PATTERN.test(path))

  return [...new Set(matches)]
}

function toolOutputToText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text
  }
  if (value && typeof value === 'object' && Array.isArray(value.content)) {
    const text = value.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim()
    if (text) return text
  }
  if (value && typeof value === 'object' && typeof value.content === 'string') {
    return value.content
  }
  if (value && typeof value === 'object' && typeof value.diff === 'string') {
    return value.diff
  }
  if (value && typeof value === 'object' && Array.isArray(value.results)) {
    const lines = value.results
      .map((entry) => entry?.path)
      .filter((path) => typeof path === 'string' && path.length > 0)
    if (lines.length > 0) return lines.join('\n')
  }
  if (value && typeof value === 'object' && Array.isArray(value.entries)) {
    const lines = value.entries
      .map((entry) => {
        if (!entry || typeof entry.path !== 'string' || !entry.path) return null
        return entry.is_dir ? `${entry.path}/` : entry.path
      })
      .filter(Boolean)
    if (lines.length > 0) return lines.join('\n')
  }
  if (value && typeof value === 'object' && Array.isArray(value.files)) {
    const lines = value.files
      .map((entry) => {
        if (!entry || typeof entry.path !== 'string' || !entry.path) return null
        const status = typeof entry.status === 'string' ? entry.status : '?'
        return `${status} ${entry.path}`
      })
      .filter(Boolean)
    if (lines.length > 0) return lines.join('\n')
    if (value.is_repo === true) return 'Clean working tree'
  }
  if (value && typeof value === 'object' && ('stdout' in value || 'stderr' in value)) {
    const stdout = typeof value.stdout === 'string' ? value.stdout.trim() : ''
    const stderr = typeof value.stderr === 'string' ? value.stderr.trim() : ''
    const combined = [stdout, stderr].filter(Boolean).join('\n')
    if (combined) return combined
  }
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeLegacyToolInvocation(toolInvocation) {
  if (!toolInvocation) return null

  let status = 'running'
  switch (toolInvocation.state) {
    case 'result':
      status = 'complete'
      break
    case 'error':
      status = 'error'
      break
    case 'call':
    case 'partial-call':
    default:
      status = 'running'
  }

  return {
    key: toolInvocation.toolCallId,
    name: toolInvocation.toolName,
    input: toolInvocation.args || {},
    output: toolOutputToText(toolInvocation.result),
    rawOutput: toolInvocation.result,
    error: status === 'error' ? toolOutputToText(toolInvocation.result) || 'Tool failed' : undefined,
    status,
  }
}

function isStaticToolUiPart(part) {
  if (!part || typeof part !== 'object') return false
  const type = String(part.type || '')
  if (!type.startsWith('tool-')) return false
  return ![
    'tool-call',
    'tool-result',
    'tool-error',
    'tool-use',
    'tool_use',
    'tool-invocation',
    'tool-input-available',
    'tool-output-available',
    'tool-output-error',
  ].includes(type)
}

function normalizeToolPart(part) {
  if (isStaticToolUiPart(part)) {
    const state = String(part.state || '').toLowerCase()
    const output = state === 'output-error'
      ? (part.errorText || 'Tool failed')
      : toolOutputToText(part.output)
    const status = state === 'output-error'
      ? 'error'
      : (state === 'output-available'
          ? (part.preliminary ? 'running' : 'complete')
          : 'running')

    return {
      key: part.toolCallId || part.id,
      name: part.toolName || String(part.type || '').slice('tool-'.length),
      input: part.input || {},
      output,
      rawOutput: state === 'output-error' ? part.errorText : (part.output ?? null),
      error: status === 'error' ? output : undefined,
      status,
    }
  }

  if (part?.type === 'tool_use' || part?.type === 'tool-use') {
    const toolCallId = part.toolCallId || part.id
    const output = toolOutputToText(part.output || part.result)
    const status = String(part.status || '').toLowerCase()
    const isError = part.isError === true || status === 'error'
    const resolvedStatus = isError
      ? 'error'
      : (status === 'pending' || status === 'running' || status === 'streaming' ? 'running' : 'complete')

    return {
      key: toolCallId,
      name: part.toolName || part.name,
      input: part.args || part.input || {},
      output,
      rawOutput: part.output ?? part.result ?? null,
      error: isError ? output || 'Tool failed' : undefined,
      status: resolvedStatus,
    }
  }

  if (part?.type === 'tool-call') {
    return {
      key: part.toolCallId,
      name: part.toolName,
      input: part.input || {},
      output: '',
      rawOutput: null,
      status: 'running',
    }
  }

  if (part?.type === 'tool-result') {
    return {
      key: part.toolCallId,
      name: part.toolName,
      input: part.input || {},
      output: toolOutputToText(part.output),
      rawOutput: part.output,
      status: part.preliminary ? 'running' : 'complete',
    }
  }

  if (part?.type === 'tool-error') {
    const errorText = toolOutputToText(part.error) || 'Tool failed'
    return {
      key: part.toolCallId,
      name: part.toolName,
      input: part.input || {},
      output: errorText,
      rawOutput: part.error,
      error: errorText,
      status: 'error',
    }
  }

  if (part?.type === 'tool-invocation') {
    return normalizeLegacyToolInvocation(part.toolInvocation)
  }

  // PI transport custom types
  if (part?.type === 'tool-input-available') {
    return {
      key: part.toolCallId,
      name: part.toolName,
      input: part.input || {},
      output: '',
      rawOutput: null,
      status: 'running',
    }
  }

  if (part?.type === 'tool-output-available') {
    return {
      key: part.toolCallId,
      name: part.toolName || '',
      input: {},
      output: toolOutputToText(part.output),
      rawOutput: part.output,
      status: part.preliminary ? 'running' : 'complete',
    }
  }

  if (part?.type === 'tool-output-error') {
    const errorText = part.errorText || 'Tool failed'
    return {
      key: part.toolCallId,
      name: part.toolName || '',
      input: {},
      output: errorText,
      rawOutput: part.errorText,
      error: errorText,
      status: 'error',
    }
  }

  return null
}

function getToolPartId(part) {
  if (!part || typeof part !== 'object') return null
  return part.toolCallId || part.id || part.toolInvocation?.toolCallId || null
}

function toolPartPriority(part) {
  if (isStaticToolUiPart(part)) {
    const state = String(part.state || '').toLowerCase()
    if (state === 'output-error') return 3
    if (state === 'output-available') return part.preliminary ? 1 : 2
    return 0
  }
  if (part?.type === 'tool_use' || part?.type === 'tool-use') {
    const status = String(part.status || '').toLowerCase()
    if (part.isError === true || status === 'error') return 3
    if (status === 'pending' || status === 'running' || status === 'streaming') return 1
    return 2
  }
  if (part?.type === 'tool-error' || part?.type === 'tool-output-error') return 3
  if (part?.type === 'tool-result') return part.preliminary ? 1 : 2
  if (part?.type === 'tool-output-available') return part.preliminary ? 1 : 2
  if (part?.type === 'tool-call' || part?.type === 'tool-input-available') return 0
  return -1
}

function selectVisibleToolParts(parts) {
  const selected = new Map()

  for (const part of parts) {
    const toolCallId = getToolPartId(part)
    if (!toolCallId) continue

    const priority = toolPartPriority(part)
    if (priority < 0) continue

    const current = selected.get(toolCallId)
    if (!current || priority >= current.priority) {
      selected.set(toolCallId, { part, priority })
    }
  }

  return new Map(
    Array.from(selected.entries()).map(([toolCallId, value]) => [toolCallId, value.part]),
  )
}

function openCodeArtifact(path, onOpenArtifact, activeSessionId) {
  if (!path || typeof onOpenArtifact !== 'function') return
  onOpenArtifact({
    kind: 'code',
    canonicalKey: path,
    title: path.split('/').pop() || path,
    source: 'agent',
    sourceSessionId: activeSessionId || null,
    rendererKey: 'code',
    params: { path },
    status: 'ready',
  })
}

function InlineArtifactLinks({
  links = [],
  onOpenArtifact,
  activeSessionId,
}) {
  if (!links.length || typeof onOpenArtifact !== 'function') return null

  return (
    <div className="vc-inline-links">
      {links.map((path) => (
        <button
          key={path}
          type="button"
          className="vc-inline-link"
          onClick={() => openCodeArtifact(path, onOpenArtifact, activeSessionId)}
        >
          {path}
        </button>
      ))}
    </div>
  )
}

function InlineOpenArtifactLink({ artifact, onOpenArtifact }) {
  if (!artifact || typeof onOpenArtifact !== 'function') return null

  return (
    <button
      type="button"
      className="vc-inline-link"
      onClick={() => onOpenArtifact(artifact)}
    >
      Open {artifact.title}
    </button>
  )
}

function TextPart({ text, onOpenArtifact, activeSessionId, showFileLinks = false }) {
  const filePaths = showFileLinks && onOpenArtifact ? detectFilePaths(text) : []

  return (
    <div className="vc-msg-part">
      <TextBlock text={text} className="vc-msg-markdown" />
      <InlineArtifactLinks
        links={filePaths}
        onOpenArtifact={onOpenArtifact}
        activeSessionId={activeSessionId}
      />
    </div>
  )
}

function ToolPart({ part, onOpenArtifact, activeSessionId }) {
  const normalized = normalizeToolPart(part)
  if (!normalized) return null

  const { shouldOpen, artifact } = bridgeToolResultToArtifact(
    normalized.name,
    normalized.input,
    normalized.rawOutput,
    activeSessionId,
  )

  return (
    <div className="vc-msg-tool">
      <div className="vc-msg-tool-renderer">
        {renderToolPart(normalized)}
      </div>
      {shouldOpen && artifact && (
        <div className="vc-inline-links">
          <InlineOpenArtifactLink artifact={artifact} onOpenArtifact={onOpenArtifact} />
        </div>
      )}
    </div>
  )
}

function renderPart(part, index, visibleToolParts, onOpenArtifact, activeSessionId, showFileLinks) {
  switch (part.type) {
    case 'text':
      return (
        <TextPart
          key={index}
          text={part.text}
          onOpenArtifact={onOpenArtifact}
          activeSessionId={activeSessionId}
          showFileLinks={showFileLinks}
        />
      )

    case 'reasoning':
      return (
        <div key={index} className="vc-msg-reasoning" data-part="reasoning">
          <TextBlock
            text={part.reasoning || part.text}
            className="vc-msg-markdown vc-msg-markdown-muted"
          />
        </div>
      )

    case 'tool-call':
    case 'tool-result':
    case 'tool-error':
    case 'tool_use':
    case 'tool-use': {
      const toolCallId = getToolPartId(part)
      if (toolCallId && visibleToolParts.get(toolCallId) !== part) {
        return null
      }
      return (
        <ToolPart
          key={toolCallId || index}
          part={part}
          onOpenArtifact={onOpenArtifact}
          activeSessionId={activeSessionId}
        />
      )
    }

    case 'tool-invocation':
      return (
        <ToolPart
          key={part.toolInvocation?.toolCallId || index}
          part={part}
          onOpenArtifact={onOpenArtifact}
          activeSessionId={activeSessionId}
        />
      )

    // PI transport custom chunk types that useChat may pass through as parts
    case 'tool-input-available':
    case 'tool-output-available':
    case 'tool-output-error':
      return (
        <ToolPart
          key={part.toolCallId || index}
          part={part}
          onOpenArtifact={onOpenArtifact}
          activeSessionId={activeSessionId}
        />
      )

    default:
      if (isStaticToolUiPart(part)) {
        const toolCallId = getToolPartId(part)
        if (toolCallId && visibleToolParts.get(toolCallId) !== part) {
          return null
        }
        return (
          <ToolPart
            key={toolCallId || index}
            part={part}
            onOpenArtifact={onOpenArtifact}
            activeSessionId={activeSessionId}
          />
        )
      }
      if (HIDDEN_PROTOCOL_PARTS.has(part.type || '')) return null
      return null
  }
}

export default function ChatMessage({
  message,
  onOpenArtifact,
  activeSessionId = null,
  isLastAssistantMessage = false,
}) {
  const isUser = message.role === 'user'
  const roleLabel = isUser ? 'You' : 'Agent'
  const parts = Array.isArray(message.parts) ? message.parts : []
  const hasParts = parts.length > 0
  const fallbackText = typeof message.content === 'string' ? message.content : ''
  const visibleToolParts = selectVisibleToolParts(parts)
  // Only show clickable file links on the last assistant message to avoid clutter
  const showFileLinks = !isUser && isLastAssistantMessage

  return (
    <div className="vc-msg">
      <div className="vc-msg-role">
        <div
          className={`vc-msg-avatar ${isUser ? 'vc-msg-avatar-user' : 'vc-msg-avatar-agent'}`}
          data-testid="chat-avatar"
        >
          {isUser ? <User size={11} /> : <Sparkles size={11} />}
        </div>
        {roleLabel}
      </div>

      <div className="vc-msg-body">
        {hasParts
          ? parts.map((part, index) => renderPart(
            part,
            index,
            visibleToolParts,
            onOpenArtifact,
            activeSessionId,
            showFileLinks,
          ))
          : (fallbackText ? (
            <TextPart
              text={fallbackText}
              onOpenArtifact={onOpenArtifact}
              activeSessionId={activeSessionId}
              showFileLinks={showFileLinks}
            />
          ) : null)}
      </div>
    </div>
  )
}
