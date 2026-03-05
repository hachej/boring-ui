import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Image, FileText, Loader2, Sparkles, ChevronLeft } from 'lucide-react'
import {
  AssistantIf,
  AssistantRuntimeProvider,
  useLocalRuntime,
  MessagePrimitive,
  ComposerPrimitive,
  useAssistantApi,
  useMessage,
  useAssistantState,
} from '@assistant-ui/react'
import ChatPanel, { chatThemeVars } from './ChatPanel'
import MessageList, { Messages, EmptyState } from './MessageList'
import TextBlock from './TextBlock'
import SessionHeader from './SessionHeader'
import BashToolRenderer from './BashToolRenderer'
import ReadToolRenderer from './ReadToolRenderer'
import WriteToolRenderer from './WriteToolRenderer'
import EditToolRenderer from './EditToolRenderer'
import GlobToolRenderer from './GlobToolRenderer'
import GrepToolRenderer from './GrepToolRenderer'
import ToolUseBlock, { ToolOutput } from './ToolUseBlock'
import PermissionPanel from './PermissionPanel'
import './styles.css'
import { buildWsUrl } from '../../utils/apiBase'
import { apiFetch, apiFetchJson, openWebSocketUrl } from '../../utils/transport'
import { routes } from '../../utils/routes'
import { getDataProvider, createHttpProvider } from '../../providers/data'

// Generate a valid UUID, with fallback for environments without crypto.randomUUID
const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback: generate UUID v4 format using Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Helper to safely find content in arrays (content might be a string sometimes)
const findContent = (content, predicate) => {
  if (!Array.isArray(content)) return undefined
  return content.find(predicate)
}

const extractResultText = (payload) => {
  const raw = payload?.result
  if (!raw) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw?.text === 'string') return raw.text
  if (typeof raw?.message === 'string') return raw.message
  if (typeof raw?.result === 'string') return raw.result
  const content = raw?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textPart = content.find((part) => part?.type === 'text')
    if (textPart?.text) return textPart.text
  }
  return ''
}

const SLASH_MENU_GROUPS = [
  { id: 'context', label: 'Context' },
  { id: 'model', label: 'Model' },
  { id: 'customize', label: 'Customize' },
  { id: 'commands', label: 'Commands' },
]

const MODEL_OPTIONS = [
  { id: 'sonnet', label: 'Sonnet', value: 'sonnet', description: 'Recommended' },
  { id: 'opus', label: 'Opus', value: 'opus', description: 'Most capable' },
  { id: 'haiku', label: 'Haiku', value: 'haiku', description: 'Fastest' },
]

const DEFAULT_SLASH_COMMANDS = [
  // Context
  { id: 'clear', label: '/clear', description: 'Clear the conversation', group: 'context' },
  // Model
  { id: 'model', label: '/model', description: 'Switch AI model', group: 'model', hasSubmenu: true },
  { id: 'thinking', label: '/thinking', description: 'Toggle thinking mode', group: 'model', isToggle: true },
  // Customize (CLI-only items marked)
  { id: 'memory', label: '/memory', description: 'Manage memory/context', group: 'customize' },
  { id: 'permissions', label: '/permissions', description: 'Manage permissions', group: 'customize' },
  { id: 'mcp', label: '/mcp', description: 'MCP servers (CLI)', group: 'customize', cliOnly: true },
  { id: 'hooks', label: '/hooks', description: 'Hooks (CLI)', group: 'customize', cliOnly: true },
  { id: 'agents', label: '/agents', description: 'Agents (CLI)', group: 'customize', cliOnly: true },
  // Commands
  { id: 'help', label: '/help', description: 'Show available commands', group: 'commands' },
  { id: 'compact', label: '/compact', description: 'Compact conversation', group: 'commands' },
  { id: 'cost', label: '/cost', description: 'Show token usage', group: 'commands' },
  { id: 'init', label: '/init', description: 'Initialize project', group: 'commands' },
  { id: 'terminal', label: '/terminal', description: 'Switch to CLI mode', group: 'commands' },
  { id: 'restart', label: '/restart', description: 'Restart session', group: 'commands', isAction: true },
]

const HISTORY_STORAGE_PREFIX = 'kurt-web-claude-stream-history'
const HISTORY_LIMIT = 200

const getHistoryKey = (sessionId) => {
  if (!sessionId) return null
  return `${HISTORY_STORAGE_PREFIX}-${sessionId}`
}

const loadStoredHistory = (sessionId) => {
  const key = getHistoryKey(sessionId)
  if (!key) return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

const saveStoredHistory = (sessionId, messages) => {
  const key = getHistoryKey(sessionId)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(messages))
  } catch {
    // Ignore storage errors
  }
}

const normalizeSlashCommands = (commands) => {
  if (!Array.isArray(commands)) return DEFAULT_SLASH_COMMANDS
  // Always start with all default commands
  const defaultIds = new Set(DEFAULT_SLASH_COMMANDS.map((cmd) => cmd.id))
  // Add any extra commands from backend that aren't in defaults
  const extraCommands = commands
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .filter((name) => {
      // Normalize: strip leading / for comparison
      const normalized = name.startsWith('/') ? name.slice(1) : name
      return !defaultIds.has(normalized)
    })
    .map((name) => {
      const normalized = name.startsWith('/') ? name.slice(1) : name
      return {
        id: normalized,
        label: `/${normalized}`,
        description: 'Plugin command',
        group: 'commands',
      }
    })
  return [...DEFAULT_SLASH_COMMANDS, ...extraCommands]
}

const CLI_OPTIONS_KEY = 'kurt-web-claude-cli-options'
const DEFAULT_CLI_OPTIONS = {
  model: '',
  maxThinkingTokens: '',
  maxTurns: '',
  maxBudgetUsd: '',
  allowedTools: '',
  disallowedTools: '',
}

const buildRestartKey = (options) => {
  const normalized = {
    maxTurns: String(options?.maxTurns || '').trim(),
    maxBudgetUsd: String(options?.maxBudgetUsd || '').trim(),
    allowedTools: options?.allowedTools?.trim() || '',
    disallowedTools: options?.disallowedTools?.trim() || '',
  }
  return JSON.stringify(normalized)
}

const formatSessionLabel = (sessionId, sessions) => {
  if (!sessionId) return 'New conversation'
  const shortId = sessionId.slice(0, 8)
  const index = sessions.findIndex((session) => session.id === sessionId)
  const prefix = index >= 0 ? `Session ${index + 1} (Claude)` : 'Session (Claude)'
  return `${prefix} - ${shortId}`
}

const normalizeStoredOptions = (options) => ({
  model: options?.model?.trim() || '',
  maxThinkingTokens: String(options?.maxThinkingTokens || '').trim(),
  maxTurns: String(options?.maxTurns || '').trim(),
  maxBudgetUsd: String(options?.maxBudgetUsd || '').trim(),
  allowedTools: options?.allowedTools?.trim() || '',
  disallowedTools: options?.disallowedTools?.trim() || '',
})

const buildFileSpec = (attachment) => {
  if (!attachment?.fileId || !attachment?.relativePath) return ''
  return `${attachment.fileId}:${attachment.relativePath}`
}

const optionalQueryString = (value) =>
  value === undefined || value === null || value === '' ? undefined : String(value)

const optionalQueryNumberLike = (value) =>
  value === undefined || value === null || value === '' || typeof value === 'boolean'
    ? undefined
    : value

const buildClaudeStreamQuery = (
  sessionId,
  mode,
  forceNew = false,
  resume = false,
  options = {},
  fileSpecs = [],
) => {
  const files = Array.isArray(fileSpecs) ? fileSpecs.filter(Boolean) : []
  return {
    session_id: optionalQueryString(sessionId),
    mode: optionalQueryString(mode),
    force_new: forceNew ? '1' : undefined,
    resume: resume ? '1' : undefined,
    model: optionalQueryString(options?.model),
    max_thinking_tokens: optionalQueryNumberLike(options?.maxThinkingTokens),
    max_turns: optionalQueryNumberLike(options?.maxTurns),
    max_budget_usd: optionalQueryNumberLike(options?.maxBudgetUsd),
    allowed_tools: optionalQueryString(options?.allowedTools),
    disallowed_tools: optionalQueryString(options?.disallowedTools),
    file: files.length ? files : undefined,
  }
}

const buildClaudeStreamWsUrl = (
  sessionId,
  mode,
  forceNew = false,
  resume = false,
  options = {},
  fileSpecs = []
) => {
  const route = routes.ws.claudeStream(
    buildClaudeStreamQuery(sessionId, mode, forceNew, resume, options, fileSpecs),
  )
  return buildWsUrl(route.path, route.query)
}

const uploadAttachment = async (file) => {
  const formData = new FormData()
  formData.append('file', file)
  const route = routes.attachments.upload()
  const res = await apiFetch(route.path, {
    query: route.query,
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    throw new Error('Upload failed')
  }
  return res.json()
}

const fetchSessions = async () => {
  try {
    const route = routes.sessions.list()
    const { response, data } = await apiFetchJson(route.path, { query: route.query })
    const res = response
    if (!res.ok) return []
    return data.sessions || []
  } catch {
    return []
  }
}

// Module-level helpers cannot use React hooks, so they access the provider
// through singleton state (with HTTP fallback when no pre-mount provider is set).
const getActiveDataProvider = (() => {
  /** @type {ReturnType<typeof createHttpProvider> | null} */
  let fallbackProvider = null
  return () => {
    const provider = getDataProvider()
    if (provider) return provider
    if (!fallbackProvider) {
      fallbackProvider = createHttpProvider()
    }
    return fallbackProvider
  }
})()

const searchFiles = async (query, onError) => {
  if (!query || query.length < 1) return []
  try {
    const provider = getActiveDataProvider()
    const response = await provider.files.search(query)
    const results = Array.isArray(response)
      ? response
      : (Array.isArray(response?.results) ? response.results : [])
    return results
      .map((f) => {
        const path = typeof f?.path === 'string' ? f.path : ''
        const inferredName = path ? path.split('/').pop() : ''
        return {
          id: path || inferredName,
          label: f?.name || inferredName,
          path,
          dir: f?.dir || (path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''),
        }
      })
      .filter((item) => item.path)
  } catch (error) {
    onError?.({
      title: 'File search failed',
      detail: error?.message || 'Unable to reach the backend.',
      suggestions: ['Check the backend status and retry.'],
      source: 'search',
      canRetry: true,
      canRestart: false,
    }, { showBanner: false })
    return []
  }
}

const fetchMentionDefaults = async (onError) => {
  try {
    const provider = getActiveDataProvider()
    const response = await provider.files.list('.')
    const entries = Array.isArray(response)
      ? response
      : (Array.isArray(response?.entries) ? response.entries : [])
    const files = entries.filter((entry) => !entry.is_dir)
    return files.map((file) => ({
      id: file.path || file.name,
      label: file.name || file.path,
      path: file.path || file.name,
      dir: (file.path || '').includes('/') ? file.path.split('/').slice(0, -1).join('/') : '',
    }))
  } catch (error) {
    onError?.({
      title: 'File list failed',
      detail: error?.message || 'Unable to reach the backend.',
      suggestions: ['Check the backend status and retry.'],
      source: 'search',
      canRetry: true,
      canRestart: false,
    }, { showBanner: false })
    return []
  }
}

export const __claudeStreamChatTestUtils = import.meta.env.MODE === 'test'
  ? {
      searchFiles,
      fetchMentionDefaults,
    }
  : undefined

const createNewSession = async () => {
  try {
    const route = routes.sessions.create()
    const { response, data } = await apiFetchJson(route.path, { query: route.query, method: 'POST' })
    const res = response
    if (!res.ok) return null
    return data.session_id
  } catch {
    return null
  }
}

const mergeStreamText = (previous, incoming) => {
  if (!previous) return incoming
  if (incoming.startsWith(previous)) return incoming
  if (previous.startsWith(incoming)) return previous
  return previous + incoming
}

const extractImagesFromText = (text, imageCache) => {
  if (!text) return { text: '', images: [] }
  const images = []
  let cleaned = text
  const dataUrlRegex = /!\[[^\]]*\]\((data:image\/[^)]+)\)/g
  let match
  while ((match = dataUrlRegex.exec(text)) !== null) {
    images.push(match[1])
  }
  const tokenRegex = /\[\[image:([^\]]+)\]\]/g
  while ((match = tokenRegex.exec(text)) !== null) {
    const cached = imageCache?.[match[1]]
    if (cached?.dataUrl) {
      images.push(cached.dataUrl)
    }
  }
  cleaned = cleaned.replace(dataUrlRegex, '').replace(tokenRegex, '').trim()
  return { text: cleaned, images }
}

const dataUrlToImagePart = (dataUrl) => {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || '')
  if (!match) return null
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: match[1],
      data: match[2],
    },
  }
}

const parseGrepResults = (output) => {
  if (!output) return []
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)$/)
      if (!match) return { file: 'output', matches: [{ line: 1, content: line }] }
      return {
        file: match[1],
        matches: [{ line: Number(match[2]), content: match[3] }],
      }
    })
}

const parseGlobFiles = (output) => {
  if (!output) return []
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

const ToolFallback = ({ name, input, output }) => {
  return (
    <ToolUseBlock
      toolName={name}
      description={input ? 'Custom tool input' : undefined}
      status="complete"
      collapsible={Boolean(output)}
      defaultExpanded={true}
    >
      {input && (
        <ToolOutput>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(input, null, 2)}
          </pre>
        </ToolOutput>
      )}
      {output && (
        <ToolOutput style={{ marginTop: '8px' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{output}</pre>
        </ToolOutput>
      )}
    </ToolUseBlock>
  )
}

const useClaudeStreamRuntime = (
  currentSessionId,
  setCurrentSessionId,
  mode,
  cliOptions,
  resume,
  contextFiles,
  clearContextFiles,
  fileAttachments,
  clearFileAttachments,
  onStreamingChange,
  onControlMessage,
  onError,
  onSlashCommands,
  onUserMessageId,
  onLastMessageChange,
  imageCache,
  clearComposerRef,
  onSettingsSync,
  clearHistoryRef,
) => {
  const wsRef = useRef(null)
  const queueRef = useRef([])
  const waitersRef = useRef([])
  const closedRef = useRef(false)
  const modeRef = useRef(mode)
  const optionsRef = useRef(cliOptions)
  const resumeRef = useRef(Boolean(resume))
  const contextFilesRef = useRef(contextFiles)
  const clearContextFilesRef = useRef(clearContextFiles)
  const fileAttachmentsRef = useRef(fileAttachments)
  const clearFileAttachmentsRef = useRef(clearFileAttachments)
  const imageCacheRef = useRef(imageCache)
  const permissionToolRef = useRef(new Map())
  const [sessionName, setSessionName] = useState('New conversation')
  const [isConnected, setIsConnected] = useState(false)
  const [restartCounter, setRestartCounter] = useState(0)
  const [historyCleared, setHistoryCleared] = useState(false)

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  // Keep refs updated
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    optionsRef.current = cliOptions
  }, [cliOptions])
  useEffect(() => {
    resumeRef.current = Boolean(resume)
  }, [resume])
  useEffect(() => {
    contextFilesRef.current = contextFiles
  }, [contextFiles])
  useEffect(() => {
    clearContextFilesRef.current = clearContextFiles
  }, [clearContextFiles])
  useEffect(() => {
    fileAttachmentsRef.current = fileAttachments
  }, [fileAttachments])
  useEffect(() => {
    clearFileAttachmentsRef.current = clearFileAttachments
  }, [clearFileAttachments])
  useEffect(() => {
    imageCacheRef.current = imageCache
  }, [imageCache])

  // Clear conversation history (for /clear command)
  const clearHistory = useCallback(() => {
    const sessionKey = currentSessionId || sessionName
    if (sessionKey) {
      const key = getHistoryKey(sessionKey)
      if (key) localStorage.removeItem(key)
    }
    // Set historyCleared flag BEFORE incrementing counter to ensure
    // the parent's historySeed useMemo sees it during the same render cycle
    setHistoryCleared(true)
    setRestartCounter((c) => c + 1)
  }, [currentSessionId, sessionName])

  // Expose clearHistory via ref for use in adapter
  useEffect(() => {
    if (clearHistoryRef) {
      clearHistoryRef.current = clearHistory
    }
  }, [clearHistoryRef, clearHistory])

  const lastModeRef = useRef(null)
  const lastOptionsKeyRef = useRef(null)
  const lastAttachmentKeyRef = useRef('')

  const connect = useCallback((sessionId, connectMode, resumeOverride, fileSpecsOverride) => {
    const useMode = connectMode || modeRef.current
    const shouldResume =
      typeof resumeOverride === 'boolean' ? resumeOverride : resumeRef.current
    const fileSpecs = Array.isArray(fileSpecsOverride)
      ? fileSpecsOverride
      : (fileAttachmentsRef.current || [])
        .filter((attachment) => attachment?.status === 'ready')
        .map((attachment) => buildFileSpec(attachment))
        .filter(Boolean)
    const fileSpecKey = fileSpecs.join('|')
    const optionsKey = buildRestartKey(optionsRef.current)
    const optionsChanged =
      lastOptionsKeyRef.current !== null && lastOptionsKeyRef.current !== optionsKey
    const attachmentsChanged = fileSpecKey && lastAttachmentKeyRef.current !== fileSpecKey
    lastModeRef.current = useMode
    lastOptionsKeyRef.current = optionsKey

    // Close existing connection if switching sessions or mode
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const oldWs = wsRef.current
      wsRef.current = null // Prevent auto-reconnect from old WebSocket
      oldWs.close()
    }

    return new Promise((resolve, reject) => {
      const shouldForceNew = optionsChanged || attachmentsChanged
      const url = buildClaudeStreamWsUrl(
        sessionId,
        useMode,
        shouldForceNew,
        shouldResume,
        optionsRef.current,
        fileSpecs,
      )
      console.log('[ClaudeStream] Connecting to:', url)
      const ws = openWebSocketUrl(url)
      wsRef.current = ws
      closedRef.current = false

      ws.onopen = () => {
        console.log('[ClaudeStream] Connected successfully')
        if (wsRef.current !== ws) return
        setIsConnected(true)
        if (fileSpecKey) {
          lastAttachmentKeyRef.current = fileSpecKey
        }
        ws.send(JSON.stringify({
          type: 'control',
          subtype: 'initialize',
          capabilities: {
            permissions: true,
            file_diffs: true,
            user_questions: true,
          },
        }))
        resolve(ws)
      }
      ws.onclose = (event) => {
        console.log('[ClaudeStream] WebSocket closed:', event.code, event.reason)
        if (wsRef.current !== ws) return
        setIsConnected(false)
        // Mark as closed and flush pending waiters to unblock the generator
        closedRef.current = true
        while (waitersRef.current.length > 0) {
          const waiter = waitersRef.current.shift()
          waiter()
        }
        // Auto-reconnect only for abnormal close (1006 = connection lost)
        // Don't reconnect for 1000 (normal close) or 1001 (going away) - those are intentional
        if (event.code === 1006) {
          console.log('[ClaudeStream] Connection lost, auto-reconnecting in 1 second...')
          setTimeout(() => {
            if (wsRef.current === null || wsRef.current.readyState === WebSocket.CLOSED) {
              console.log('[ClaudeStream] Attempting reconnection...')
              connect(sessionId, useMode, false).catch((err) => {
                console.error('[ClaudeStream] Reconnection failed:', err)
              })
            }
          }, 1000)
        }
      }
      ws.onerror = (event) => {
        console.error('[ClaudeStream] WebSocket error:', event)
        if (wsRef.current !== ws) return
        setIsConnected(false)
        onError?.({
          title: 'Connection error',
          detail: 'Unable to reach the Claude CLI backend.',
          suggestions: [
            'Make sure the backend is running.',
            'Try reconnecting or restarting the session.',
          ],
          source: 'connection',
          canRetry: true,
          canRestart: true,
        })
        reject(event)
      }
      ws.onmessage = (event) => {
        if (wsRef.current !== ws) return
        let payload = null
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }

        if (payload.type === 'system' && payload.subtype === 'connected' && payload.session_id) {
          setSessionName(payload.session_id)
          setCurrentSessionId(payload.session_id)
          // Sync settings from backend
          if (payload.settings) {
            onSettingsSync?.(payload.settings)
          }
        }
        if (payload.type === 'system' && payload.subtype === 'error') {
          onError?.({
            title: 'Claude session error',
            detail: payload.message || 'Claude CLI reported an error.',
            suggestions: [
              'Check the CLI output for details.',
              'Try restarting the session.',
            ],
            source: 'session',
            canRetry: true,
            canRestart: true,
          })
        }
        if (payload.type === 'system' && payload.subtype === 'init') {
          if (Array.isArray(payload.slash_commands)) {
            onSlashCommands?.(payload.slash_commands)
          }
        }

        // Handle session_not_found error - restart with a new session
        if (payload.type === 'system' && payload.subtype === 'session_not_found') {
          console.log('[ClaudeStream] Session not found, restarting with new session')
          // Close current connection
          if (wsRef.current) {
            wsRef.current.close()
            wsRef.current = null
          }
          setIsConnected(false)
          // Generate new session ID and reconnect
          const newSessionId = generateUUID()
          setCurrentSessionId(newSessionId)
          resumeRef.current = false
          // Explicitly reconnect after state update
          setTimeout(() => {
            console.log('[ClaudeStream] Reconnecting with new session:', newSessionId)
            connect(newSessionId, modeRef.current, false).catch((err) => {
              console.error('[ClaudeStream] Reconnect failed:', err)
            })
          }, 100)
          return
        }

        if (payload.type === 'control') {
          onControlMessage?.(payload)
        }
        const queue = queueRef.current
        if (queue) {
          queue.push(payload)
          const waiter = waitersRef.current.shift()
          if (waiter) waiter()
        }
      }
    })
  }, [setCurrentSessionId, onControlMessage, onError, onSlashCommands, onSettingsSync])

  const nextPayload = useCallback(async () => {
    // If connection is closed and queue is empty, return null to signal termination
    if (closedRef.current && queueRef.current.length === 0) {
      return null
    }
    if (queueRef.current.length) return queueRef.current.shift()
    return new Promise((resolve) => {
      waitersRef.current.push(() => {
        // Check again after being woken up - might be due to close
        if (closedRef.current && queueRef.current.length === 0) {
          resolve(null)
        } else {
          resolve(queueRef.current.shift())
        }
      })
    })
  }, [])

  // Connect proactively on mount or when session changes
  useEffect(() => {
    connect(currentSessionId, mode).catch(() => {
      // Connection failed, will retry on message send
    })
  }, [connect, currentSessionId, mode])

  const switchSession = useCallback((sessionId, resumeOverride = true) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
    connect(sessionId, undefined, resumeOverride).catch(() => {})
  }, [connect])

  // Force restart session (e.g., after permission change)
  const restartSession = useCallback(() => {
    // Increment counter to force runtime reset and clear chat history
    setRestartCounter(c => c + 1)
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setIsConnected(false)
    const fileSpecs = (fileAttachmentsRef.current || [])
      .filter((attachment) => attachment?.status === 'ready')
      .map((attachment) => buildFileSpec(attachment))
      .filter(Boolean)
    // Reconnect with force_new to restart CLI with new settings
    const wsUrl = buildClaudeStreamWsUrl(
      currentSessionId,
      modeRef.current,
      true,
      resumeRef.current,
      optionsRef.current,
      fileSpecs,
    ) // force_new=true
    const ws = openWebSocketUrl(wsUrl)
    wsRef.current = ws
    ws.onopen = () => {
      if (wsRef.current !== ws) return
      setIsConnected(true)
      ws.send(JSON.stringify({
        type: 'control',
        subtype: 'initialize',
        capabilities: {
          permissions: true,
          file_diffs: true,
          user_questions: true,
        },
      }))
    }
    ws.onclose = () => {
      if (wsRef.current !== ws) return
      setIsConnected(false)
    }
    ws.onerror = (event) => {
      if (wsRef.current !== ws) return
      console.error('[ClaudeStream] WebSocket error during restart:', event)
      setIsConnected(false)
    }
    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'system' && payload.subtype === 'connected') {
          console.log('[ClaudeStream] Session restarted with new permissions')
        }
        queueRef.current?.push(payload)
        const waiter = waitersRef.current?.shift()
        if (waiter) waiter()
      } catch {
        // Ignore JSON parse errors
      }
    }
    return ws
  }, [currentSessionId])

  // Send approval decision through WebSocket
  // For control_response: decision is "allow" or "deny", toolInput is the original tool input
  const sendApprovalResponse = useCallback((decision, requestId, toolInput = {}, updatedInput, permissionSuggestions, message) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[ClaudeStream] Cannot send approval - WebSocket not connected')
      return
    }
    const response = {
      type: 'control_response',
      request_id: requestId,
      decision,
      tool_input: toolInput,
    }
    if (updatedInput) {
      response.updatedInput = updatedInput
    }
    if (permissionSuggestions) {
      response.permission_suggestions = permissionSuggestions
    }
    if (message) {
      response.message = message
    }

    console.log('[ClaudeStream] Sending control response:', response)
    wsRef.current.send(JSON.stringify(response))
    const pendingTool = permissionToolRef.current.get(requestId)
    if (pendingTool) {
      if (decision === 'allow') {
        pendingTool.status = 'running'
        setTimeout(() => {
          if (pendingTool.status === 'running') {
            pendingTool.status = 'complete'
          }
        }, 180)
      } else {
        pendingTool.status = 'error'
        pendingTool.error = message || 'Permission denied'
      }
      permissionToolRef.current.delete(requestId)
    }
  }, [])

  const sendQuestionResponse = useCallback((requestId, answers) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[ClaudeStream] Cannot send question response - WebSocket not connected')
      return
    }
    const response = {
      type: 'control_response',
      request_id: requestId,
      answers: answers || {},
    }
    wsRef.current.send(JSON.stringify(response))
  }, [])

  const sendControlMessage = useCallback((subtype, payload = {}) => {
    const trySend = (attempt = 0) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'control',
          subtype,
          ...payload,
        }))
        return
      }
      if (attempt < 10) {
        // Retry up to 10 times (5 seconds total)
        setTimeout(() => trySend(attempt + 1), 500)
      } else {
        console.warn('[ClaudeStream] Control message failed - connection not established after retries')
      }
    }
    trySend()
  }, [])

  // Send a message directly (for retry)
  const sendMessage = useCallback(async (text, files = []) => {
    if (!text?.trim()) return

    const ws = await connect(currentSessionId)
    ws.send(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      mode: modeRef.current,
      context_files: files,
    }))
  }, [connect, currentSessionId])

  const adapter = {
    async *run({ messages, abortSignal }) {
      const lastUser = messages.filter((m) => m.role === 'user').pop()
      const userText = findContent(lastUser?.content, (c) => c.type === 'text')?.text || ''
      const extracted = extractImagesFromText(userText, imageCacheRef.current)
      const cleanedText = extracted.text || ''
      const imageParts = extracted.images
        .map((img) => dataUrlToImagePart(img))
        .filter(Boolean)
      if (!cleanedText.trim() && imageParts.length === 0) return

      // Track last user message for potential retry
      const files = contextFilesRef.current.map(f => f.path)
      onLastMessageChange?.({ text: cleanedText, files })

      onStreamingChange?.(true)

      const fileSpecs = (fileAttachmentsRef.current || [])
        .filter((attachment) => attachment?.status === 'ready')
        .map((attachment) => buildFileSpec(attachment))
        .filter(Boolean)
      const ws = await connect(currentSessionId, undefined, undefined, fileSpecs)
      const abortHandler = () => {
        sendControlMessage('interrupt')
      }
      abortSignal?.addEventListener('abort', abortHandler, { once: true })
      queueRef.current = []
      waitersRef.current = []

      // Check if it's a slash command
      const trimmed = cleanedText.trim()
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.split(' ')[0].toLowerCase()

        // Handle /clear - send to CLI AND reset frontend
        if (cmd === '/clear') {
          // Send to CLI so it clears its conversation state
          ws.send(JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: '/clear' }] },
            mode: modeRef.current,
          }))
          // Clear frontend state immediately
          if (clearHistoryRef?.current) {
            clearHistoryRef.current()
          }
          return
        }

        if (cmd === '/restart') {
          clearComposerRef?.current?.()
          restartSession()
          return
        }

        if (cmd === '/terminal') {
          yield { content: [{ type: 'text', text: 'Use the Terminal panel to access CLI mode.' }] }
          return
        }

        // Pass slash commands to CLI as regular user messages (per VSCode extension)
        // CLI interprets messages starting with / as commands
        ws.send(JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: trimmed }] },
          mode: modeRef.current,
        }))
      } else {
        const content = []
        if (cleanedText.trim()) {
          content.push({ type: 'text', text: cleanedText })
        }
        content.push(...imageParts)
        ws.send(JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
          mode: modeRef.current,
          context_files: files,
        }))
      }
      clearContextFilesRef.current?.()
      clearFileAttachmentsRef.current?.()

      const parts = []
      let textPartIndex = -1
      const toolIndex = new Map()
      const toolSignature = new Set()
      const seenUuids = new Set() // Track seen message uuids to avoid duplicates
      let latestCommandOutput = null // Track latest command output (for slash commands, show only the last)
      let hasAssistantText = false
      let running = true
      const scheduleStatusChange = (toolPart, fromStatus, toStatus, delayMs) => {
        setTimeout(() => {
          if (toolPart.status === fromStatus) {
            toolPart.status = toStatus
          }
        }, delayMs)
      }

      while (running) {
        if (abortSignal?.aborted) break
        const payload = await nextPayload()
        // null means connection closed - exit the loop
        if (payload === null) {
          console.log('[ClaudeStream] Connection closed, ending stream')
          onStreamingChange?.(false)
          break
        }
        if (!payload) continue

        // Log ALL incoming messages
        console.log('[ClaudeStream] <<', payload.type, payload.subtype || '', payload.uuid?.slice(0, 8) || '')

        if (payload.type === 'assistant') {
          const rawContent = payload.message?.content
          if (typeof rawContent === 'string') {
            parts.push({ type: 'text', text: rawContent })
            textPartIndex = parts.length - 1
            hasAssistantText = true
          }
          const content = Array.isArray(rawContent) ? rawContent : []
          content.forEach((part) => {
            // Handle thinking content blocks - wrap in <thinking> tags for TextBlock
            if (part.type === 'thinking') {
              const thinkingText = `<thinking>${part.thinking || ''}</thinking>\n\n`
              if (textPartIndex === -1) {
                parts.push({ type: 'text', text: thinkingText })
                textPartIndex = parts.length - 1
              } else {
                const existing = parts[textPartIndex]
                // Prepend thinking to existing text
                existing.text = thinkingText + (existing.text || '')
              }
              hasAssistantText = true
            }
            if (part.type === 'text' || part.type === 'output_text') {
              if (textPartIndex === -1) {
                parts.push({ type: 'text', text: part.text || '' })
                textPartIndex = parts.length - 1
              } else {
                const existing = parts[textPartIndex]
                existing.text = mergeStreamText(existing.text || '', part.text || '')
              }
              hasAssistantText = true
            }
            if (part.type === 'tool_use') {
              // Skip if we already have this exact tool by ID
              if (toolIndex.has(part.id)) {
                return
              }
              // Create a signature based on tool name + key input params to avoid duplicates
              const inputKey = part.input?.file_path || part.input?.path || part.input?.command || part.id
              const signature = `${part.name}-${inputKey}`
              if (toolSignature.has(signature)) {
                // Update existing tool with this ID reference
                return
              }
              const toolPart = {
                type: 'tool_use',
                id: part.id,
                name: part.name,
                input: part.input || {},
                output: '',
                status: 'pending',
                lineCount: null,
              }
              scheduleStatusChange(toolPart, 'pending', 'running', 120)
              toolSignature.add(signature)
              toolIndex.set(part.id, toolPart)
              parts.push(toolPart)
              textPartIndex = -1
            }
          })
        }

        if (payload.type === 'user') {
          const messageUuid = payload.uuid || ''

          // Skip duplicates by uuid
          if (messageUuid && seenUuids.has(messageUuid)) {
            console.log('[ClaudeStream] Skip duplicate uuid:', messageUuid.slice(0, 8))
            continue
          }
          if (messageUuid) seenUuids.add(messageUuid)

          const messageId =
            payload.message?.id ||
            payload.message?.message_id ||
            payload.message?.uuid ||
            payload.message_id ||
            payload.uuid
          if (messageId) {
            onUserMessageId?.(messageId)
          }

          // Check for slash command output (wrapped in <local-command-stdout> tags)
          const messageContent = payload.message?.content
          if (typeof messageContent === 'string' && messageContent.includes('<local-command-stdout>')) {
            const match = messageContent.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)
            if (match) {
              // Store latest - we'll display only the last one when result arrives
              latestCommandOutput = match[1].trim()
              console.log('[ClaudeStream] Stored cmd output:', latestCommandOutput.slice(0, 50))
            }
          }

          const toolResult = findContent(payload.message?.content, (c) => c.type === 'tool_result')
          if (toolResult?.tool_use_id && toolIndex.has(toolResult.tool_use_id)) {
            const toolPart = toolIndex.get(toolResult.tool_use_id)
            const resultText = [
              toolResult.content,
              payload.tool_use_result?.stdout,
              payload.tool_use_result?.stderr,
            ]
              .filter(Boolean)
              .join('\n')
            if ((toolPart.name || '').toLowerCase() === 'read') {
              const lines = resultText ? resultText.split('\n').length : 0
              toolPart.lineCount = lines
              toolPart.output = ''
            } else {
              toolPart.output = mergeStreamText(toolPart.output || '', resultText)
            }
            if (toolResult.is_error) {
              toolPart.status = 'error'
            } else {
              toolPart.status = 'streaming'
              scheduleStatusChange(toolPart, 'streaming', 'complete', 160)
            }
          }
        }

        // Handle control_request from CLI (interactive permission prompt)
        // This is sent when --permission-prompt-tool stdio is used
        if (payload.type === 'control_request') {
          console.log('[ClaudeStream] Control request detected:', payload)
          const request = payload.request || {}
          const toolName = request.tool_name || request.toolName || 'tool'
          const toolInput = request.input || request.tool_input || request.inputs || {}
          const toolId = request.tool_use_id || payload.request_id || `control-${Date.now()}`
          if (!toolIndex.has(toolId)) {
            const inputKey = toolInput.file_path || toolInput.path || toolInput.command || toolId
            const signature = `${toolName}-${inputKey}`
            if (!toolSignature.has(signature)) {
              const toolPart = {
                type: 'tool_use',
                id: toolId,
                name: toolName,
                input: toolInput,
                output: '',
                status: 'pending',
                lineCount: null,
              }
              toolSignature.add(signature)
              toolIndex.set(toolId, toolPart)
              parts.push(toolPart)
              textPartIndex = -1
              if (payload.request_id) {
                permissionToolRef.current.set(payload.request_id, toolPart)
              }
            }
          }
          onStreamingChange?.({
            type: 'control_request',
            payload,
          })
        }
        if (payload.type === 'control_cancel_request') {
          console.log('[ClaudeStream] Control cancel detected:', payload)
          const requestId = payload.request_id
          if (requestId && permissionToolRef.current.has(requestId)) {
            const toolPart = permissionToolRef.current.get(requestId)
            toolPart.status = 'error'
            toolPart.error = 'Permission request canceled'
            permissionToolRef.current.delete(requestId)
          }
          onStreamingChange?.({
            type: 'control_cancel_request',
            payload,
          })
        }
        if (payload.type === 'control' && payload.subtype === 'user_question_request') {
          console.log('[ClaudeStream] User question request detected:', payload)
          onStreamingChange?.({
            type: 'user_question',
            payload,
          })
        }

        // Also check for explicit permission request messages (if Claude sends them)
        const isPermissionRequest =
          payload.type === 'permission_request' ||
          payload.type === 'approval_request' ||
          payload.type === 'input_request' ||
          payload.type === 'user_input_request' ||
          (payload.type === 'control' && payload.subtype === 'permission_request') ||
          (payload.type === 'system' && payload.subtype === 'permission_request')

        if (isPermissionRequest) {
          console.log('[ClaudeStream] Permission request detected:', payload)
          onStreamingChange?.({
            type: 'permission',
            payload,
          })
        }

        if (payload.type === 'result') {
          running = false

          // Handle error_during_execution - display errors to the user
          if (payload.subtype === 'error_during_execution' || payload.errors?.length > 0) {
            const errors = payload.errors || []
            const errorMessages = errors.map(e => typeof e === 'string' ? e : e.message || JSON.stringify(e))
            const errorText = errorMessages.length > 0
              ? `⚠️ Error: ${errorMessages.join('\n')}`
              : '⚠️ An error occurred during execution'
            console.log('[ClaudeStream] Error during execution:', errorText)
            parts.push({ type: 'text', text: errorText })
            textPartIndex = parts.length - 1
            onStreamingChange?.(false)
          } else {
            const finalText = extractResultText(payload)
            if (finalText && !hasAssistantText) {
              parts.push({ type: 'text', text: finalText })
              textPartIndex = parts.length - 1
            }

            // Add the latest command output (if any) now that we have the final result
            if (latestCommandOutput) {
              console.log('[ClaudeStream] Adding final output:', latestCommandOutput.slice(0, 50))
              parts.push({ type: 'text', text: latestCommandOutput })
              textPartIndex = parts.length - 1
            }

            // Check for permission denials BEFORE signaling end
            // In --print mode, Claude reports denied tools in the result
            if (payload.permission_denials?.length > 0) {
              console.log('[ClaudeStream] Permission denials found:', JSON.stringify(payload.permission_denials, null, 2))
              // Show the first denied tool for user to grant permission
              const denial = payload.permission_denials[0]
              onStreamingChange?.({
                type: 'permission_denied',
                payload: {
                  tool_name: denial.tool_name,
                  tool_use_id: denial.tool_use_id,
                  tool_input: denial.tool_input,
                },
              })
              // Don't call onStreamingChange(false) - keep showing the panel
            } else {
              // No denials, signal end of streaming
              onStreamingChange?.(false)
            }
          }
        }

        yield { content: parts.map((part) => ({ ...part })) }
      }

      abortSignal?.removeEventListener?.('abort', abortHandler)
    },
  }

  return {
    adapter,
    sessionName,
    isConnected,
    switchSession,
    sendApprovalResponse,
    sendQuestionResponse,
    sendMessage,
    restartSession,
    restartCounter,
    historyCleared,
    setHistoryCleared,
    sendControlMessage,
  }
}

const renderToolPart = (part) => {
  const input = part.input || {}
  const output = part.output || ''
  const toolName = (part.name || '').toLowerCase()

  if (toolName === 'bash') {
    return (
      <BashToolRenderer
        command={input.command || input.cmd}
        description={input.description}
        output={output}
        error={part.error}
        status={part.status}
        compact={true}
      />
    )
  }
  if (toolName === 'read') {
    return (
      <ReadToolRenderer
        filePath={input.path || input.file_path}
        content={null}
        lineCount={part.lineCount || undefined}
        status={part.status}
        hideContent={true}
      />
    )
  }
  if (toolName === 'write') {
    return (
      <WriteToolRenderer
        filePath={input.path || input.file_path}
        content={input.content || output}
        error={part.error}
        status={part.status}
      />
    )
  }
  if (toolName === 'edit') {
    return (
      <EditToolRenderer
        filePath={input.path || input.file_path}
        diff={input.diff || output}
        error={part.error}
        status={part.status}
      />
    )
  }
  if (toolName === 'glob') {
    return (
      <GlobToolRenderer
        pattern={input.pattern || input.glob}
        files={parseGlobFiles(output)}
        status={part.status}
      />
    )
  }
  if (toolName === 'grep') {
    return (
      <GrepToolRenderer
        pattern={input.pattern || input.query}
        path={input.path}
        results={parseGrepResults(output)}
        status={part.status}
      />
    )
  }

  return <ToolFallback name={part.name} input={input} output={output} />
}

const AssistantMessage = () => {
  const message = useMessage()
  const content = message.content || []
  const isStreaming = message.status?.type === 'running'

  // Find the index of the last text part to only show cursor there
  const lastTextIndex = content.reduce((last, part, idx) =>
    part.type === 'text' ? idx : last, -1)

  return (
    <MessagePrimitive.Root
      className="claude-message-assistant"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--chat-spacing-sm, 8px)',
      }}
    >
      {content.map((part, index) => {
        if (part.type === 'text') {
          const isLastText = index === lastTextIndex
          return (
            <div key={`text-${index}`} className="claude-assistant-line">
              <span
                className="claude-assistant-bullet"
                style={{ color: isStreaming ? 'var(--chat-accent)' : 'var(--chat-text-muted)' }}
              >
                ●
              </span>
              <div className="claude-assistant-text">
                <TextBlock text={part.text} />
                {isStreaming && isLastText && (
                  <span className="claude-streaming-cursor" aria-hidden="true">
                    ▌
                  </span>
                )}
              </div>
            </div>
          )
        }

        if (part.type === 'tool_use') {
          return (
            <div key={`tool-${part.id || index}`}>
              {renderToolPart(part)}
            </div>
          )
        }
        return null
      })}
    </MessagePrimitive.Root>
  )
}

const MODES = [
  { id: 'ask', title: 'Ask', description: 'Asks for approval for each action.' },
  { id: 'act', title: 'Auto-Accept', description: 'Automatically accepts file edits.' },
  { id: 'plan', title: 'Plan', description: 'Defines a plan before acting.' },
]

const mapControlToMode = (mode) => {
  const map = {
    default: 'ask',
    acceptEdits: 'act',
    plan: 'plan',
    bypassPermissions: 'act',
    dontAsk: 'act',
    delegate: 'ask',
  }
  return map[mode] || 'ask'
}

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!bytes || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

const ImageIcon = () => <Image size={16} aria-hidden="true" />

const FileIcon = () => <FileText size={16} aria-hidden="true" />

const INLINE_IMAGE_LIMIT = 80000

const ComposerShell = ({
  isConnected,
  mode,
  onModeChange,
  showModeMenu,
  setShowModeMenu,
  attachments,
  setAttachments,
  fileAttachments,
  setFileAttachments,
  onAttachFiles,
  isUploadingAttachments,
  contextFiles,
  setContextFiles,
  onRegisterImages,
  slashCommands,
  onError,
  isThinkingEnabled,
  currentModel,
  onRestartSession,
  onToggleThinking,
  onModelSelect,
  clearComposerRef,
  inputAreaHeight,
}) => {
  const api = useAssistantApi()
  const composerApi = useMemo(() => api.composer(), [api])
  const composerText = useAssistantState(({ composer }) => composer.text)
  const isRunning = useAssistantState(({ thread }) => thread.isRunning)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [showAtMenu, setShowAtMenu] = useState(false)
  const [showModelSubmenu, setShowModelSubmenu] = useState(false)
  const [menuFilter, setMenuFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [menuNavigated, setMenuNavigated] = useState(false)
  const currentMode = MODES.find((item) => item.id === mode) || MODES[0]
  const modeLabel = currentMode?.title || mode
  const modeIcon = (modeLabel || 'M').charAt(0).toUpperCase()

  const inputRef = useRef(null)
  const focusInput = useCallback(() => {
    inputRef.current?.focus?.()
  }, [])

  const applyComposerText = useCallback((nextText) => {
    composerApi?.setText?.(nextText)
    if (inputRef.current) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      if (nativeSetter) {
        nativeSetter.call(inputRef.current, nextText)
        inputRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }, [composerApi])

  // Set up clearComposerRef to allow external clearing of the input
  useEffect(() => {
    if (clearComposerRef) {
      clearComposerRef.current = () => applyComposerText('')
    }
  }, [clearComposerRef, applyComposerText])

  const appendAttachmentsToText = useCallback(() => {
    if (attachments.length === 0) return
    const currentText = composerText || ''
    const hasImage = attachments.some((img) => currentText.includes(img.dataUrl))
    if (hasImage) return
    const markdown = attachments
      .map((img, idx) => {
        const token = `[[image:${img.id}]]`
        if (img.dataUrl && img.dataUrl.length <= INLINE_IMAGE_LIMIT) {
          return `![pasted-image-${idx + 1}](${img.dataUrl})`
        }
        onRegisterImages?.(img)
        return token
      })
      .join('\n')
    const nextText = currentText.trim()
      ? `${currentText.trimEnd()}\n\n${markdown}`
      : markdown
    applyComposerText(nextText)
    setAttachments([])
  }, [attachments, composerText, setAttachments, applyComposerText, onRegisterImages])
  const slashMenuRef = useRef(null)
  const selectedItemRef = useRef(null)

  // Close slash menu when clicking outside
  useEffect(() => {
    if (!showSlashMenu && !showAtMenu) return
    const handleClickOutside = (event) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(event.target)) {
        setShowSlashMenu(false)
        setShowAtMenu(false)
        setMenuNavigated(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSlashMenu, showAtMenu])

  // Auto-scroll selected menu item into view
  useEffect(() => {
    if ((showSlashMenu || showAtMenu) && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [selectedIndex, showSlashMenu, showAtMenu])


  const [searchedFiles, setSearchedFiles] = useState([])

  const filteredCommands = (slashCommands || DEFAULT_SLASH_COMMANDS).filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(menuFilter.toLowerCase()) ||
      cmd.description.toLowerCase().includes(menuFilter.toLowerCase())
  )

  // Fetch files when @ menu filter changes
  useEffect(() => {
    if (!showAtMenu) return
    const query = menuFilter || ''
    const controller = new AbortController()
    let timerId = null
    const handleResults = (files) => {
      if (!controller.signal.aborted) {
        setSearchedFiles(files.slice(0, 10))
      }
    }

    if (query.length < 1) {
      timerId = window.setTimeout(() => {
        fetchMentionDefaults(onError).then(handleResults)
      }, 150)
    } else {
      searchFiles(query, onError).then(handleResults)
    }

    return () => {
      controller.abort()
      if (timerId) {
        window.clearTimeout(timerId)
      }
    }
  }, [showAtMenu, menuFilter, onError])

  const handleMenuSelect = (item, type) => {
    if (type === 'at') {
      // Add file to context (if not already added)
      setContextFiles?.((prev) => {
        if (prev.some((f) => f.id === item.id)) return prev
        return [...prev, item]
      })
      // Clear the @ from input
      const currentText = composerText || ''
      const atIndex = currentText.lastIndexOf('@')
      if (atIndex >= 0) {
        const newText = currentText.slice(0, atIndex).trimEnd()
        applyComposerText(newText)
      }
    } else if (item.hasSubmenu && item.id === 'model') {
      // Show model submenu instead of inserting
      setShowModelSubmenu(true)
      return
    } else if (item.isModelOption) {
      // Model option selected - call handler directly
      console.log('[MenuSelect] Model option selected:', item.value, item.label, 'onModelSelect:', typeof onModelSelect)
      onModelSelect?.(item.value, item.label)
      // Clear slash command from input
      const currentText = composerText || ''
      const slashIndex = currentText.lastIndexOf('/')
      if (slashIndex >= 0) {
        const newText = currentText.slice(0, slashIndex).trimEnd()
        applyComposerText(newText)
      }
    } else if (item.isAction && item.id === 'restart') {
      // Restart action - call handler directly and clear input
      onRestartSession?.()
      // Clear after React updates
      requestAnimationFrame(() => {
        applyComposerText('')
        composerApi?.setText?.('')
      })
    } else if (item.isToggle && item.id === 'thinking') {
      // Thinking toggle - call handler directly, keep menu open
      onToggleThinking?.()
      // Keep menu open so user can see the toggle change (don't clear input)
      return
    } else {
      // Slash command - insert text
      const newValue = `${item.label} `
      applyComposerText(newValue)
    }
    focusInput()
    setShowSlashMenu(false)
    setShowAtMenu(false)
    setShowModelSubmenu(false)
  }

  const handleKeyDown = (event) => {
    if (showSlashMenu || showAtMenu) {
      const list = showAtMenu ? searchedFiles : filteredCommands
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, list.length - 1))
        setMenuNavigated(true)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        setMenuNavigated(true)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (list.length > 0) {
          const index = menuNavigated ? selectedIndex : 0
          const item = list[index]
          handleMenuSelect(item, showAtMenu ? 'at' : 'slash')
          // Don't reset navigation if it's a toggle (menu stays open)
          if (!(item.isToggle && item.id === 'thinking')) {
            setMenuNavigated(false)
          }
          return
        }
        setShowSlashMenu(false)
        setShowAtMenu(false)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setShowSlashMenu(false)
        setShowAtMenu(false)
        setMenuNavigated(false)
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !showSlashMenu && !showAtMenu) {
      if (isUploadingAttachments) {
        event.preventDefault()
        return
      }
      if (attachments.length > 0) {
        event.preventDefault()
        appendAttachmentsToText()
        requestAnimationFrame(() => api.composer().send())
        return
      }
      appendAttachmentsToText()
    }
  }

  const handlePaste = (event) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    event.preventDefault()
    imageItems.forEach((item) => {
      const file = item.getAsFile()
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          { id: `${Date.now()}-${file.name}`, dataUrl: reader.result, name: file.name },
        ])
      }
      reader.readAsDataURL(file)
    })
  }

  return (
    <ComposerPrimitive.Root className="claude-input" style={inputAreaHeight ? { height: `${inputAreaHeight}px` } : undefined}>
      <div className="claude-input-box" data-mode={mode} ref={slashMenuRef}>
        {(showSlashMenu || showAtMenu) && (
          <div className="claude-menu">
            {showSlashMenu && (showModelSubmenu ? (
              // Model selector view - replaces the main menu
              <div className="claude-menu-section">
                <button
                  className="claude-menu-back"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setShowModelSubmenu(false)
                  }}
                  type="button"
                >
                  <ChevronLeft size={16} />
                  <span>Model</span>
                </button>
                {MODEL_OPTIONS.map((model, idx) => {
                  const isSelected = currentModel && currentModel.includes(model.value)
                  return (
                    <button
                      key={model.id}
                      ref={idx === selectedIndex ? selectedItemRef : null}
                      className={`claude-menu-item${idx === selectedIndex ? ' selected' : ''}${isSelected ? ' current' : ''}`}
                      onPointerDown={(event) => {
                        console.log('[ModelBtn] pointerdown:', model.value)
                        event.preventDefault()
                        event.stopPropagation()
                        handleMenuSelect({ ...model, isModelOption: true }, 'slash')
                      }}
                      onClick={(event) => {
                        console.log('[ModelBtn] click:', model.value)
                        event.preventDefault()
                        event.stopPropagation()
                        handleMenuSelect({ ...model, isModelOption: true }, 'slash')
                      }}
                      type="button"
                    >
                      <span>{model.label}</span>
                      <span className="desc">{model.description}{isSelected ? ' ✓' : ''}</span>
                    </button>
                  )
                })}
              </div>
            ) : (() => {
              // Main slash menu view
              let flatIdx = 0
              return SLASH_MENU_GROUPS.map((group) => {
                const groupCommands = filteredCommands.filter((cmd) => cmd.group === group.id)
                if (groupCommands.length === 0) return null
                return (
                  <div key={group.id} className="claude-menu-section">
                    <div className="claude-menu-group">{group.label}</div>
                    {groupCommands.map((cmd) => {
                      const idx = flatIdx
                      flatIdx += 1
                      const isToggleItem = cmd.isToggle && cmd.id === 'thinking'
                      const toggleState = isToggleItem ? isThinkingEnabled : false
                      const isModelItem = cmd.hasSubmenu && cmd.id === 'model'
                      return (
                        <button
                          key={cmd.id}
                          ref={idx === selectedIndex ? selectedItemRef : null}
                          className={`claude-menu-item ${idx === selectedIndex ? 'selected' : ''}${cmd.cliOnly ? ' cli-only' : ''}${isToggleItem ? ' toggle-item' : ''}${isModelItem ? ' has-submenu' : ''}`}
                          onPointerDown={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleMenuSelect(cmd, 'slash')
                          }}
                          type="button"
                        >
                          <span>{cmd.label}</span>
                          {isToggleItem ? (
                            <span className={`toggle-indicator ${toggleState ? 'on' : 'off'}`}>
                              {toggleState ? 'On' : 'Off'}
                            </span>
                          ) : isModelItem ? (
                            <span className="desc">{currentModel || 'default'} ›</span>
                          ) : (
                            <span className="desc">{cmd.description}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )
              })
            })())}
            {showAtMenu &&
              searchedFiles.map((file, idx) => (
                <button
                  key={file.id}
                  ref={idx === selectedIndex ? selectedItemRef : null}
                  className={`claude-menu-item ${idx === selectedIndex ? 'selected' : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    handleMenuSelect(file, 'at')
                  }}
                  type="button"
                >
                  <span>@{file.label}</span>
                  <span className="desc">{file.path}</span>
                </button>
              ))}
            {showAtMenu && searchedFiles.length === 0 && (
              <div className="claude-menu-empty">Type to search files…</div>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="claude-attachments">
            {attachments.map((img) => (
              <div key={img.id} className="claude-attachment">
                <img src={img.dataUrl} alt={img.name} />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== img.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {fileAttachments?.length > 0 && (
          <div className="claude-file-attachments">
            {fileAttachments.map((file) => (
              <div key={file.id} className={`claude-file-attachment ${file.status || ''}`}>
                <div className="claude-file-meta">
                  <span className="claude-file-name">{file.name || 'attachment'}</span>
                  {file.size ? (
                    <span className="claude-file-size">{formatBytes(file.size)}</span>
                  ) : null}
                </div>
                <div className="claude-file-status">
                  {file.status === 'uploading' && <span>Uploading…</span>}
                  {file.status === 'ready' && <span>Ready</span>}
                  {file.status === 'error' && <span>Error</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setFileAttachments((prev) => prev.filter((item) => item.id !== file.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {contextFiles?.length > 0 && (
          <div className="claude-context-files">
            {contextFiles.map((file) => (
              <div key={file.id} className="claude-context-pill">
                <span className="claude-context-pill-icon"><FileText size={14} /></span>
                <span className="claude-context-pill-label">{file.label}</span>
                <button
                  type="button"
                  onClick={() => setContextFiles?.((prev) => prev.filter((f) => f.id !== file.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <ComposerPrimitive.Input
          asChild
          ref={inputRef}
          autoFocus
          placeholder={isConnected ? 'Reply...' : 'Connecting...'}
          rows={1}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onChange={(e) => {
            const text = e.target.value
            const lastChar = text.slice(-1)
            const prevChar = text.slice(-2, -1)
            if (lastChar === '/' && (prevChar === '' || prevChar === ' ')) {
              setShowSlashMenu(true)
              setShowAtMenu(false)
              setMenuFilter('')
              setSelectedIndex(0)
              setMenuNavigated(false)
            } else if (lastChar === '@' && (prevChar === '' || prevChar === ' ')) {
              setShowAtMenu(true)
              setShowSlashMenu(false)
              setMenuFilter('')
              setSelectedIndex(0)
              setMenuNavigated(false)
            } else if (showSlashMenu) {
              const triggerIndex = text.lastIndexOf('/')
              if (triggerIndex >= 0) {
                setMenuFilter(text.slice(triggerIndex + 1))
              } else {
                setShowSlashMenu(false)
                setMenuNavigated(false)
              }
            } else if (showAtMenu) {
              const triggerIndex = text.lastIndexOf('@')
              if (triggerIndex >= 0) {
                setMenuFilter(text.slice(triggerIndex + 1))
              } else {
                setShowAtMenu(false)
                setMenuNavigated(false)
              }
            }
          }}
        >
          <textarea />
        </ComposerPrimitive.Input>
        <div className="claude-input-actions">
          <div className="claude-input-left">
            <label className="claude-icon-button" title="Attach image">
              <ImageIcon />
              <input
                type="file"
                accept="image/*"
                className="claude-file-input"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  files.forEach((file) => {
                    const reader = new FileReader()
                    reader.onload = () => {
                      setAttachments((prev) => [
                        ...prev,
                        { id: `${Date.now()}-${file.name}`, dataUrl: reader.result, name: file.name },
                      ])
                    }
                    reader.readAsDataURL(file)
                  })
                  event.target.value = ''
                }}
              />
            </label>
            <label className="claude-icon-button" title="Attach file">
              <FileIcon />
              <input
                type="file"
                className="claude-file-input"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  onAttachFiles?.(files)
                  event.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              className="claude-icon-button"
              title="Slash commands"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const currentText = composerText || ''
                if (!currentText.endsWith('/')) {
                  applyComposerText(`${currentText}/`)
                }
                setShowSlashMenu(true)
                setShowAtMenu(false)
                setSelectedIndex(0)
                setMenuFilter('')
                setMenuNavigated(false)
                setTimeout(() => focusInput(), 0)
              }}
            >
              /
            </button>
            <button
              type="button"
              className="claude-icon-button"
              title="Mention file"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const currentText = composerText || ''
                if (!currentText.endsWith('@')) {
                  applyComposerText(`${currentText}@`)
                }
                setShowAtMenu(true)
                setShowSlashMenu(false)
                setSelectedIndex(0)
                setMenuFilter('')
                setMenuNavigated(false)
                setTimeout(() => focusInput(), 0)
              }}
            >
              @
            </button>
          </div>
          <div className="claude-input-right">
            <div className="claude-mode-wrapper">
              <button
                type="button"
                className="claude-mode-button"
                onClick={() => setShowModeMenu((prev) => !prev)}
              >
                <span className={`claude-mode-icon claude-mode-${mode}`}>{modeIcon}</span>
                <span className="claude-mode-label">{modeLabel}</span>
              </button>
              {showModeMenu && (
                <div className="claude-mode-menu">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`claude-mode-item ${mode === item.id ? 'active' : ''}`}
                      onClick={() => {
                        onModeChange?.(item.id)
                        setShowModeMenu(false)
                      }}
                    >
                      <span className={`claude-mode-icon claude-mode-${item.id}`}>
                        {item.title[0]}
                      </span>
                      <span className="claude-mode-text">
                        <span className="claude-mode-title">{item.title}</span>
                        <span className="claude-mode-desc">{item.description}</span>
                      </span>
                      {mode === item.id && <span className="claude-mode-check">v</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isRunning ? (
              <ComposerPrimitive.Cancel className="claude-send claude-stop">
                ■
              </ComposerPrimitive.Cancel>
            ) : (
              <ComposerPrimitive.Send
                className="claude-send"
                disabled={!isConnected || isUploadingAttachments}
                onClick={() => appendAttachmentsToText()}
              >
                ↑
              </ComposerPrimitive.Send>
            )}
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  )
}

const formatToolSummary = (part) => {
  const name = part?.name || 'Tool'
  const input = part?.input || {}
  const output = part?.output || ''
  const status = part?.status === 'error' ? ' (error)' : ''
  const toolName = String(name)
  let header = toolName

  const path = input.path || input.file_path
  if (toolName.toLowerCase() === 'bash' && input.command) {
    header = `Bash: ${input.command}${status}`
  } else if (toolName.toLowerCase() === 'read' && path) {
    const lines = part?.lineCount ? ` (${part.lineCount} lines)` : ''
    header = `Read: ${path}${lines}${status}`
  } else if ((toolName.toLowerCase() === 'write' || toolName.toLowerCase() === 'edit') && path) {
    header = `${toolName}: ${path}${status}`
  } else if (path) {
    header = `${toolName}: ${path}${status}`
  } else if (status) {
    header = `${toolName}${status}`
  }

  if (output) {
    return `${header}\n\`\`\`\n${output}\n\`\`\``
  }
  return header
}

const normalizeHistoryMessage = (message) => {
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
    return null
  }
  const raw = Array.isArray(message.content)
    ? message.content
    : message.content
      ? [{ type: 'text', text: String(message.content) }]
      : []
  const textParts = []

  raw.forEach((part) => {
    if (!part) return
    if (part.type === 'text' || part.type === 'output_text') {
      if (part.text) {
        textParts.push({ type: 'text', text: part.text })
      }
      return
    }
    if (part.type === 'tool_use') {
      const summary = formatToolSummary(part)
      if (summary) {
        textParts.push({ type: 'text', text: summary })
      }
    }
  })

  if (textParts.length === 0) return null
  return {
    role: message.role,
    content: textParts,
  }
}

const HistoryPersister = ({ sessionId }) => {
  const messages = useAssistantState(({ thread }) => thread.messages)
  const isRunning = useAssistantState(({ thread }) => thread.isRunning)

  useEffect(() => {
    if (!sessionId) return
    if (isRunning) return
    const normalized = messages
      .map(normalizeHistoryMessage)
      .filter(Boolean)
      .slice(-HISTORY_LIMIT)
    saveStoredHistory(sessionId, normalized)
  }, [messages, sessionId, isRunning])

  return null
}

const RuntimeProvider = ({ adapter, initialMessages, children }) => {
  const runtime = useLocalRuntime(adapter, { initialMessages })
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  )
}

const extractMarkdownImages = (text, imageCache) => {
  if (!text) return { text, images: [] }
  const images = []
  let cleaned = text
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    images.push(match[1])
  }
  const tokenRegex = /\[\[image:([^\]]+)\]\]/g
  while ((match = tokenRegex.exec(text)) !== null) {
    const cached = imageCache?.[match[1]]
    if (cached) {
      images.push(cached.dataUrl || cached)
    }
  }
  cleaned = cleaned.replace(regex, '').replace(tokenRegex, '').trim()
  return { text: cleaned, images }
}

const buildQuestionAnswers = (questions, answersByQuestion) => {
  if (!Array.isArray(questions)) return {}
  const answers = {}
  questions.forEach((question, index) => {
    const answer = answersByQuestion?.[question.question]
    if (!answer) return
    if (question.multiSelect) {
      const parts = String(answer)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      if (parts.length) {
        answers[index] = parts
      }
      return
    }
    answers[index] = String(answer)
  })
  return answers
}

const formatErrorTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const UserMessageWithImages = ({ imageCache }) => {
  const message = useMessage()
  const rawText = findContent(message.content, (part) => part.type === 'text')?.text || ''
  const { text, images } = extractMarkdownImages(rawText, imageCache)

  return (
    <MessagePrimitive.Root
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginBottom: 'var(--chat-spacing-md, 12px)',
        gap: '8px',
      }}
    >
      {text && <div className="claude-user-bubble">{text}</div>}
      {images.length > 0 && (
        <div className="claude-user-attachments">
          {images.map((src, idx) => (
            <div key={`${src}-${idx}`} className="claude-user-attachment">
              <img src={src} alt={`attachment-${idx + 1}`} />
            </div>
          ))}
        </div>
      )}
    </MessagePrimitive.Root>
  )
}

const ErrorBanner = ({ error }) => {
  if (!error) return null
  return (
    <div className="claude-error-banner" role="alert">
      <div className="claude-error-title">{error.title || 'Connection error'}</div>
    </div>
  )
}

const ErrorLogModal = ({ isOpen, errors, onClear, onClose }) => {
  if (!isOpen) return null
  return (
    <div className="claude-settings-overlay" onClick={onClose}>
      <div
        className="claude-settings-modal claude-error-log-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="claude-settings-header">
          <h3>Error log</h3>
          <button type="button" className="claude-settings-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="claude-settings-body">
          {errors.length === 0 ? (
            <div className="claude-error-log-empty">No errors recorded.</div>
          ) : (
            <div className="claude-error-log">
              {errors.map((entry) => (
                <div key={entry.id} className="claude-error-log-item">
                  <div className="claude-error-log-header">
                    <div className="claude-error-log-title">{entry.title}</div>
                    <div className="claude-error-log-time">{formatErrorTime(entry.timestamp)}</div>
                  </div>
                  {entry.detail && (
                    <div className="claude-error-log-detail">{entry.detail}</div>
                  )}
                  {entry.source && (
                    <div className="claude-error-log-source">Source: {entry.source}</div>
                  )}
                  {Array.isArray(entry.suggestions) && entry.suggestions.length > 0 && (
                    <ul className="claude-error-log-suggestions">
                      {entry.suggestions.map((item, index) => (
                        <li key={`${entry.id}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="claude-settings-actions">
          <button type="button" className="claude-settings-button ghost" onClick={onClear}>
            Clear log
          </button>
          <div className="claude-settings-spacer" />
          <button type="button" className="claude-settings-button ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

const ThinkingIndicator = () => (
  <div className="claude-status" role="status" aria-live="polite">
    <Loader2 className="claude-thinking-spinner" size={16} />
    <span>Thinking...</span>
  </div>
)

const Thread = ({
  sessionLabel,
  activeSessionId,
  isConnected,
  attachments,
  setAttachments,
  fileAttachments,
  setFileAttachments,
  onAttachFiles,
  isUploadingAttachments,
  contextFiles,
  setContextFiles,
  sessions,
  showSessionDropdown,
  setShowSessionDropdown,
  onSelectSession,
  onNewSession,
  showSessionPicker,
  mode,
  onModeChange,
  approvalRequest,
  onApprovalDecision,
  errorBanner,
  imageCache,
  onRegisterImages,
  onRestartSession,
  slashCommands,
  onError,
  isThinkingEnabled,
  currentModel,
  onToggleThinking,
  onModelSelect,
  clearComposerRef,
}) => {
  const [showModeMenu, setShowModeMenu] = useState(false)
  const sessionDropdownRef = useRef(null)

  // Resizable input area via drag handle
  const INPUT_HEIGHT_KEY = 'claude-input-area-height'
  const MIN_INPUT_HEIGHT = 100
  const MAX_INPUT_HEIGHT = 500
  const DEFAULT_INPUT_HEIGHT = 140

  const [inputAreaHeight, setInputAreaHeight] = useState(() => {
    const saved = localStorage.getItem(INPUT_HEIGHT_KEY)
    return saved ? Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, parseInt(saved, 10))) : DEFAULT_INPUT_HEIGHT
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartHeight.current = inputAreaHeight
  }, [inputAreaHeight])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e) => {
      const delta = dragStartY.current - e.clientY
      const newHeight = Math.max(MIN_INPUT_HEIGHT, Math.min(MAX_INPUT_HEIGHT, dragStartHeight.current + delta))
      setInputAreaHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      localStorage.setItem(INPUT_HEIGHT_KEY, String(inputAreaHeight))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, inputAreaHeight])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showSessionPicker || !showSessionDropdown) return
    const handleClickOutside = (event) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(event.target)) {
        setShowSessionDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSessionPicker, showSessionDropdown, setShowSessionDropdown])

  useEffect(() => {
    if (!showSessionPicker && showSessionDropdown) {
      setShowSessionDropdown(false)
    }
  }, [showSessionPicker, showSessionDropdown, setShowSessionDropdown])

  return (
    <ChatPanel className="chat-panel-light">
      {errorBanner && <ErrorBanner error={errorBanner} />}

      {showSessionPicker && (
        <div style={{ position: 'relative' }} ref={sessionDropdownRef}>
          <SessionHeader
            title={sessionLabel}
            onTitleClick={() => setShowSessionDropdown((prev) => !prev)}
            onNewSession={onNewSession}
            showDropdown={true}
          />
          {showSessionDropdown && (
            <div className="claude-session-dropdown">
              {sessions.length === 0 ? (
                <div className="claude-session-item empty">No other sessions</div>
              ) : (
                sessions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`claude-session-item ${s.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => {
                      onSelectSession(s.id)
                      setShowSessionDropdown(false)
                    }}
                  >
                    <span className="claude-session-id">{s.id.slice(0, 8)}...</span>
                    <span className="claude-session-meta">
                      {s.clients} client{s.clients !== 1 ? 's' : ''}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <MessageList>
        <EmptyState>
          <div className="claude-stream-empty">
            <Sparkles className="mark" size={24} />
            <div className="headline">Ask me anything about your code</div>
            <div className="hint">I can explain files, propose edits, or help debug workflows.</div>
            <div className="claude-empty-prompts" aria-hidden="true">
              <span className="claude-empty-prompt-pill">Summarize this workspace</span>
              <span className="claude-empty-prompt-pill">Find potential regressions</span>
              <span className="claude-empty-prompt-pill">Draft a refactor plan</span>
            </div>
          </div>
        </EmptyState>
        <Messages
          components={{
            UserMessage: () => <UserMessageWithImages imageCache={imageCache} />,
            AssistantMessage,
          }}
        />
      </MessageList>

      <AssistantIf condition={({ thread }) => thread.isRunning}>
        <ThinkingIndicator />
      </AssistantIf>
      {approvalRequest && (
        <div className="claude-permission-panel">
          <PermissionPanel
            title={approvalRequest.title}
            options={approvalRequest.options}
            diff={approvalRequest.diff}
            filePath={approvalRequest.file_path}
            toolName={approvalRequest.tool_name}
            toolInput={approvalRequest.tool_input}
            blockedPath={approvalRequest.blocked_path}
            permissionSuggestions={approvalRequest.permission_suggestions}
            onSelect={onApprovalDecision}
          />
        </div>
      )}
      {/* Resize handle between messages and input */}
      <div
        className={`claude-resize-handle${isDragging ? ' dragging' : ''}`}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize input area"
      />
      <ComposerShell
        isConnected={isConnected}
        mode={mode}
        onModeChange={onModeChange}
        showModeMenu={showModeMenu}
        setShowModeMenu={setShowModeMenu}
        attachments={attachments}
        setAttachments={setAttachments}
        fileAttachments={fileAttachments}
        setFileAttachments={setFileAttachments}
        onAttachFiles={onAttachFiles}
        isUploadingAttachments={isUploadingAttachments}
        contextFiles={contextFiles}
        setContextFiles={setContextFiles}
        onRegisterImages={onRegisterImages}
        slashCommands={slashCommands}
        onError={onError}
        isThinkingEnabled={isThinkingEnabled}
        currentModel={currentModel}
        onRestartSession={onRestartSession}
        onToggleThinking={onToggleThinking}
        onModelSelect={onModelSelect}
        clearComposerRef={clearComposerRef}
        inputAreaHeight={inputAreaHeight}
      />
    </ChatPanel>
  )
}

export default function ClaudeStreamChat({
  initialSessionId = null,
  resume = false,
  onSessionStarted,
  showSessionPicker = true,
}) {
  const [attachments, setAttachments] = useState([])
  const [contextFiles, setContextFiles] = useState([])
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(initialSessionId)
  const [showSessionDropdown, setShowSessionDropdown] = useState(false)
  const [mode, setMode] = useState('ask')
  const [cliOptions, setCliOptions] = useState(() => {
    try {
      const raw = localStorage.getItem(CLI_OPTIONS_KEY)
      if (raw) {
        return { ...DEFAULT_CLI_OPTIONS, ...JSON.parse(raw) }
      }
    } catch {
      // Ignore storage errors
    }
    return { ...DEFAULT_CLI_OPTIONS }
  })
  const [fileAttachments, setFileAttachments] = useState([])
  const [approvalRequest, setApprovalRequest] = useState(null)
  const [imageCache, setImageCache] = useState({})
  const [slashCommands, setSlashCommands] = useState(DEFAULT_SLASH_COMMANDS)
  const [errorLog, setErrorLog] = useState([])
  const [activeError, setActiveError] = useState(null)
  const [showErrorLog, setShowErrorLog] = useState(false)
  const [toastMessage, setToastMessage] = useState(null)
  const retryMessageRef = useRef(null)
  const modeChangeRef = useRef(false)

  // Update session ID when initialSessionId prop changes
  useEffect(() => {
    if (initialSessionId && initialSessionId !== currentSessionId) {
      setCurrentSessionId(initialSessionId)
    }
  }, [initialSessionId, currentSessionId])

  useEffect(() => {
    try {
      localStorage.setItem(CLI_OPTIONS_KEY, JSON.stringify(normalizeStoredOptions(cliOptions)))
    } catch {
      // Ignore storage errors
    }
  }, [cliOptions])

  // Fetch sessions on mount and when dropdown opens
  useEffect(() => {
    if (showSessionDropdown) {
      fetchSessions().then(setSessions)
    }
  }, [showSessionDropdown])

  // Note: Approval polling removed - using native stream-json permission messages instead
  // The hook-based approach can be re-enabled by uncommenting and configuring .claude/settings.json hooks

  const clearContextFiles = useCallback(() => setContextFiles([]), [])
  const clearFileAttachments = useCallback(() => setFileAttachments([]), [])
  const logError = useCallback((payload, options = {}) => {
    const entry = {
      id: payload?.id || `error-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: payload?.title || 'Something went wrong',
      detail: payload?.detail || '',
      suggestions: Array.isArray(payload?.suggestions)
        ? payload.suggestions
        : (payload?.suggestion ? [payload.suggestion] : []),
      source: payload?.source || 'ui',
      timestamp: payload?.timestamp || new Date().toISOString(),
      canRetry: Boolean(payload?.canRetry),
      canRestart: Boolean(payload?.canRestart),
    }
    setErrorLog((prev) => [entry, ...prev].slice(0, 50))
    if (options.showBanner !== false) {
      setActiveError(entry)
    }
  }, [])
  const clearErrorLog = useCallback(() => {
    setErrorLog([])
    setActiveError(null)
  }, [])
  const sendApprovalResponseRef = useRef(null)
  const sendQuestionResponseRef = useRef(null)
  const sendControlMessageRef = useRef(null)
  const clearComposerRef = useRef(null)
  const clearHistoryRef = useRef(null)
  const handleStreamingChange = useCallback((event) => {
    // Handle boolean (start/stop streaming)
    if (typeof event === 'boolean') {
      if (!event) {
        // Clear any pending approval when stream ends
        setApprovalRequest(null)
      }
      return
    }

    if (event?.type === 'user_question') {
      const payload = event.payload || {}
      const questions = payload.questions || payload.request?.questions || []
      setApprovalRequest({
        id: payload.request_id || payload.id || `question-${Date.now()}`,
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions,
          answers: {},
        },
        source: 'user_question',
      })
      return
    }

    // Handle permission denial from result (--print mode)
    // Claude reports what was blocked (informational only)
    if (event?.type === 'permission_denied') {
      const payload = event.payload
      const tool = payload.tool_name || 'tool'
      const toolInput = payload.tool_input || {}
      const blockedPath = payload.blocked_path || payload.blockedPath || ''
      const filePath = toolInput.file_path || toolInput.path || toolInput.command || blockedPath || ''

      setApprovalRequest({
        id: payload.tool_use_id || `denied-${Date.now()}`,
        title: `${tool} was blocked`,
        tool_name: tool,
        tool_input: toolInput,
        file_path: filePath,
        source: 'denial',
        options: [
          { label: 'Dismiss', decision: 'dismiss' },
        ],
      })
      return
    }

    // Handle control_request from CLI (interactive permission prompt)
    // This is the native permission flow when using --permission-prompt-tool stdio
    if (event?.type === 'control_request') {
      const payload = event.payload
      const request = payload.request || {}
      const toolName = request.tool_name || request.toolName || 'tool'
      const toolInput = request.input || request.tool_input || request.inputs || {}
      const permissionSuggestions = request.permission_suggestions || request.suggestions || []
      const blockedPath = request.blocked_path || request.blockedPath || ''
      const filePath = toolInput.file_path || toolInput.path || toolInput.command || ''

      setApprovalRequest({
        id: payload.request_id || `control-${Date.now()}`,
        tool_name: toolName,
        tool_input: toolInput,
        file_path: filePath,
        blocked_path: blockedPath,
        permission_suggestions: permissionSuggestions,
        source: 'control_request',  // Mark as control request for proper response format
      })
      return
    }
    if (event?.type === 'control_cancel_request') {
      const requestId = event.payload?.request_id
      if (!requestId) {
        setApprovalRequest(null)
        return
      }
      setApprovalRequest((current) => (current && current.id === requestId ? null : current))
      return
    }
  }, [])

  const handleControlMessage = useCallback((payload) => {
    const subtype = payload?.subtype

    if (subtype === 'error') {
      logError({
        title: 'Claude control error',
        detail: payload?.error?.message || payload?.message || 'An unknown error occurred.',
        suggestions: [
          'Review the CLI output for details.',
          'Retry the action after reconnecting.',
        ],
        source: 'control',
        canRetry: true,
        canRestart: true,
      })
      return
    }

    if (subtype === 'set_permission_mode') {
      const nextMode = mapControlToMode(payload.mode)
      setMode(nextMode)
      return
    }
    if (subtype === 'set_model') {
      const nextModel = payload.model
      if (nextModel) {
        setCliOptions((prev) => ({ ...prev, model: String(nextModel) }))
      }
      return
    }
    if (subtype === 'set_max_thinking_tokens') {
      if (payload.max_thinking_tokens !== undefined && payload.max_thinking_tokens !== null) {
        setCliOptions((prev) => ({
          ...prev,
          maxThinkingTokens: String(payload.max_thinking_tokens),
        }))
      }
    }
  }, [logError])

  const handleLastMessageChange = useCallback((msg) => {
    retryMessageRef.current = msg
  }, [])

  const handleUserMessageId = useCallback(() => {
    // No longer tracking user message ID (rewind modal removed)
  }, [])

  const handleSlashCommands = useCallback((commands) => {
    setSlashCommands(normalizeSlashCommands(commands))
  }, [])

  const handleSettingsSync = useCallback((settings) => {
    if (!settings) return
    setCliOptions((prev) => {
      const next = { ...prev }
      if (settings.max_thinking_tokens !== undefined && settings.max_thinking_tokens !== null) {
        next.maxThinkingTokens = String(settings.max_thinking_tokens)
      }
      if (settings.model) {
        next.model = String(settings.model)
      }
      return next
    })
  }, [])

  const {
    adapter,
    sessionName,
    isConnected,
    switchSession,
    sendApprovalResponse,
    sendQuestionResponse,
    restartSession,
    restartCounter,
    historyCleared,
    setHistoryCleared,
    sendControlMessage,
  } = useClaudeStreamRuntime(
    currentSessionId,
    setCurrentSessionId,
    mode,
    cliOptions,
    resume,
    contextFiles,
    clearContextFiles,
    fileAttachments,
    clearFileAttachments,
    handleStreamingChange,
    handleControlMessage,
    logError,
    handleSlashCommands,
    handleUserMessageId,
    handleLastMessageChange,
    imageCache,
    clearComposerRef,
    handleSettingsSync,
    clearHistoryRef,
  )
  const streamStartedRef = useRef(false)

  useEffect(() => {
    streamStartedRef.current = false
  }, [currentSessionId])

  useEffect(() => {
    if (!isConnected || streamStartedRef.current) return
    streamStartedRef.current = true
    onSessionStarted?.(currentSessionId)
  }, [isConnected, currentSessionId, onSessionStarted])

  // Store sendApprovalResponse in ref for use in callback
  useEffect(() => {
    sendApprovalResponseRef.current = sendApprovalResponse
  }, [sendApprovalResponse])
  useEffect(() => {
    sendQuestionResponseRef.current = sendQuestionResponse
  }, [sendQuestionResponse])
  useEffect(() => {
    sendControlMessageRef.current = sendControlMessage
  }, [sendControlMessage])

  const applyModeChange = useCallback((nextMode) => {
    if (nextMode === mode) return
    modeChangeRef.current = true
    setMode(nextMode)
  }, [mode])

  useEffect(() => {
    if (!modeChangeRef.current) return
    modeChangeRef.current = false
    setTimeout(() => {
      restartSession()
    }, 0)
  }, [mode, restartSession])

  const handleApprovalDecision = useCallback(async (option) => {
    if (!option || !approvalRequest?.id) {
      setApprovalRequest(null)
      return
    }

    const decision = option.decision || (option.label?.toLowerCase().includes('deny') ? 'deny' : 'allow')
    if (decision === 'dismiss') {
      setApprovalRequest(null)
      return
    }

    if (approvalRequest.source === 'user_question' && sendQuestionResponseRef.current) {
      const input = option.updatedInput || approvalRequest.tool_input || {}
      const questions = input.questions || approvalRequest.tool_input?.questions || []
      const answers = decision === 'deny'
        ? {}
        : buildQuestionAnswers(questions, input.answers)
      sendQuestionResponseRef.current(approvalRequest.id, answers)
      setApprovalRequest(null)
      return
    }

    if (approvalRequest.source === 'control_request' && sendApprovalResponseRef.current) {
      // Send control_response for control_request (native permission flow)
      // Must include tool_input for CLI to execute the tool
      sendApprovalResponseRef.current(
        decision,
        approvalRequest.id,
        approvalRequest.tool_input || {},
        option.updatedInput,
        option.permissionSuggestions,
        option.message
      )
    }

    if (option.nextMode && option.nextMode !== mode) {
      applyModeChange(option.nextMode)
    }
    setApprovalRequest(null)
  }, [approvalRequest, mode, applyModeChange])

  const handleRestartSession = useCallback(() => {
    restartSession()
    setToastMessage('Session restarted')
    setTimeout(() => setToastMessage(null), 1500)
  }, [restartSession])

  const handleToggleThinking = useCallback(() => {
    const currentValue = Number(cliOptions.maxThinkingTokens) || 0
    const newValue = currentValue > 0 ? 0 : 10000 // Toggle between off (0) and on (10000)
    console.log('[Thinking] Toggle:', { currentValue, newValue, raw: cliOptions.maxThinkingTokens })
    sendControlMessageRef.current?.('set_max_thinking_tokens', {
      max_thinking_tokens: newValue,
    })
    setCliOptions((prev) => ({
      ...prev,
      maxThinkingTokens: String(newValue),
    }))
  }, [cliOptions.maxThinkingTokens])

  const handleModelSelect = useCallback((modelValue, modelLabel) => {
    console.log('[ModelSelect] Called with:', modelValue, modelLabel)
    console.log('[ModelSelect] sendControlMessageRef:', sendControlMessageRef.current)
    sendControlMessageRef.current?.('set_model', { model: modelValue })
    setCliOptions((prev) => {
      console.log('[ModelSelect] Setting model in cliOptions:', modelValue)
      return {
        ...prev,
        model: modelValue,
      }
    })
    setToastMessage(`Model: ${modelLabel}`)
    setTimeout(() => setToastMessage(null), 1500)
  }, [])

  const handleNewSession = useCallback(async () => {
    const newId = await createNewSession()
    if (newId) {
      switchSession(newId, false)
      // Refresh sessions list
      fetchSessions().then(setSessions)
    } else {
      logError({
        title: 'Could not start a new session',
        detail: 'The backend did not return a new session id.',
        suggestions: [
          'Make sure the backend is running.',
          'Retry creating a new session.',
        ],
        source: 'session',
        canRetry: true,
        canRestart: true,
      })
    }
  }, [switchSession, logError])

  const handleSelectSession = useCallback((sessionId) => {
    switchSession(sessionId)
  }, [switchSession])

  const handleAttachFiles = useCallback((files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return

    list.forEach((file) => {
      const tempId = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 6)}`
      setFileAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          name: file.name,
          size: file.size,
          status: 'uploading',
        },
      ])
      uploadAttachment(file)
        .then((data) => {
          setFileAttachments((prev) => prev.map((item) => (
            item.id === tempId
              ? {
                ...item,
                status: 'ready',
                fileId: data.file_id,
                relativePath: data.relative_path,
                name: data.name || file.name,
                size: data.size || file.size,
              }
              : item
          )))
        })
        .catch((error) => {
          setFileAttachments((prev) => prev.map((item) => (
            item.id === tempId
              ? {
                ...item,
                status: 'error',
                error: error?.message || 'Upload failed',
              }
              : item
          )))
          logError({
            title: `Upload failed for ${file.name}`,
            detail: error?.message || 'The file could not be uploaded.',
            suggestions: [
              'Check the file size and permissions.',
              'Try uploading the file again.',
            ],
            source: 'upload',
            canRetry: false,
            canRestart: false,
          })
        })
    })
  }, [logError])
  const handleRegisterImages = useCallback((image) => {
    if (!image?.id) return
    setImageCache((prev) => ({ ...prev, [image.id]: image }))
  }, [])

  const isUploadingAttachments = fileAttachments.some((attachment) => attachment.status === 'uploading')

  const sessionLabel = useMemo(() => {
    const id = currentSessionId || sessionName
    return formatSessionLabel(id, sessions)
  }, [currentSessionId, sessionName, sessions])

  const historySeed = useMemo(() => {
    // If history was just cleared, return empty array to force clean slate
    if (historyCleared) return []
    const sessionKey = currentSessionId || sessionName
    if (!sessionKey) return []
    return loadStoredHistory(sessionKey)
      .map(normalizeHistoryMessage)
      .filter(Boolean)
  }, [currentSessionId, sessionName, historyCleared])

  const runtimeKey = `${currentSessionId || sessionName || 'new'}-${restartCounter}`

  // Reset historyCleared flag after the runtime remounts with cleared state
  useEffect(() => {
    if (historyCleared) {
      // Use requestAnimationFrame to ensure the RuntimeProvider has remounted
      // with the cleared state before resetting the flag
      requestAnimationFrame(() => {
        setHistoryCleared(false)
      })
    }
  }, [historyCleared, setHistoryCleared])

  // Determine if thinking mode is enabled based on maxThinkingTokens
  const isThinkingEnabled = Boolean(cliOptions.maxThinkingTokens && Number(cliOptions.maxThinkingTokens) > 0)

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <style>{chatThemeVars}</style>
      <RuntimeProvider key={runtimeKey} adapter={adapter} initialMessages={historySeed}>
        <HistoryPersister sessionId={currentSessionId || sessionName} />
        <Thread
          sessionLabel={sessionLabel}
          activeSessionId={currentSessionId || sessionName}
          isConnected={isConnected}
          attachments={attachments}
          setAttachments={setAttachments}
          fileAttachments={fileAttachments}
          setFileAttachments={setFileAttachments}
          onAttachFiles={handleAttachFiles}
          isUploadingAttachments={isUploadingAttachments}
          contextFiles={contextFiles}
          setContextFiles={setContextFiles}
          sessions={sessions}
          showSessionDropdown={showSessionDropdown}
          setShowSessionDropdown={setShowSessionDropdown}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          showSessionPicker={showSessionPicker}
          mode={mode}
          onModeChange={applyModeChange}
          approvalRequest={approvalRequest}
          onApprovalDecision={handleApprovalDecision}
          errorBanner={activeError}
          imageCache={imageCache}
          onRegisterImages={handleRegisterImages}
          onRestartSession={handleRestartSession}
          slashCommands={slashCommands}
          onError={logError}
          isThinkingEnabled={isThinkingEnabled}
          currentModel={cliOptions.model}
          onToggleThinking={handleToggleThinking}
          onModelSelect={handleModelSelect}
          clearComposerRef={clearComposerRef}
        />
        <ErrorLogModal
          isOpen={showErrorLog}
          errors={errorLog}
          onClear={clearErrorLog}
          onClose={() => setShowErrorLog(false)}
        />
        {toastMessage && (
          <div className="toast-notification">{toastMessage}</div>
        )}
      </RuntimeProvider>
    </div>
  )
}
