import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import {
  publishPiSessionState,
  subscribePiSessionActions,
} from './sessionBus'
import { fetchJsonUrl, fetchUrl } from '../../utils/transport'
import { createPiRoutes } from './routes'
import { renderToolPart } from '../../components/chat/toolRenderers'

/**
 * Convert a server message (text-only or parts-based) into a display message.
 * Parts-based messages carry structured content for tool cards.
 */
const toDisplayMessage = (message) => {
  const role = message?.role === 'assistant' ? 'assistant' : 'user'
  const text = String(message?.text || '').trim()
  const parts = Array.isArray(message?.parts) ? message.parts : []
  if (!text && parts.length === 0) return null
  return {
    id: String(message?.id || `${role}-${Math.random().toString(36).slice(2, 10)}`),
    role,
    text,
    parts,
  }
}

async function readJson(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

export default function PiBackendAdapter({ serviceUrl, panelId, sessionBootstrap = 'latest' }) {
  const piRoutes = useMemo(() => createPiRoutes(serviceUrl), [serviceUrl])
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState('')
  const [messages, setMessages] = useState([])
  const [streamText, setStreamText] = useState('')
  // In-flight tool cards: Map<toolCallId, { toolName, args, status, result }>
  const [activeTools, setActiveTools] = useState(new Map())
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef(null)
  const sessionsRef = useRef([])
  const currentSessionIdRef = useRef('')

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  const publishState = useCallback((nextSessions, nextSessionId) => {
    publishPiSessionState(panelId, {
      currentSessionId: nextSessionId || '',
      sessions: Array.isArray(nextSessions) ? nextSessions : [],
    })
  }, [panelId])

  const listSessions = useCallback(async () => {
    const { response, data: payload } = await fetchJsonUrl(piRoutes.sessions())
    if (!response.ok) {
      throw new Error(`Failed to list PI sessions (${response.status})`)
    }
    return Array.isArray(payload.sessions) ? payload.sessions : []
  }, [piRoutes])

  const loadHistory = useCallback(async (sessionId) => {
    if (!sessionId) return
    const { response, data: payload } = await fetchJsonUrl(piRoutes.history(sessionId))
    if (!response.ok) {
      throw new Error(`Failed to load PI history (${response.status})`)
    }
    const nextMessages = Array.isArray(payload.messages)
      ? payload.messages.map(toDisplayMessage).filter(Boolean)
      : []
    setMessages(nextMessages)
  }, [piRoutes])

  const createSession = useCallback(async () => {
    const { response, data: payload } = await fetchJsonUrl(piRoutes.createSession(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) {
      throw new Error(`Failed to create PI session (${response.status})`)
    }
    const created = payload?.session
    if (!created?.id) {
      throw new Error('PI service returned no session id')
    }

    const nextSessions = [created, ...sessionsRef.current.filter((session) => session.id !== created.id)]
      .sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || '')))

    setSessions(nextSessions)
    setCurrentSessionId(created.id)
    setMessages([])
    setStreamText('')
    setActiveTools(new Map())
    publishState(nextSessions, created.id)
    return created.id
  }, [piRoutes, publishState])

  const switchSession = useCallback(async (sessionId) => {
    if (!sessionId) return
    setCurrentSessionId(sessionId)
    setStreamText('')
    setActiveTools(new Map())
    setError('')
    await loadHistory(sessionId)
    publishState(sessionsRef.current, sessionId)
  }, [loadHistory, publishState])

  const refreshSessions = useCallback(async () => {
    if (sessionBootstrap === 'new' && !currentSessionIdRef.current) {
      await createSession()
      return
    }

    const listed = await listSessions()
    if (listed.length === 0) {
      const newId = await createSession()
      publishState([{
        id: newId,
        title: 'New session',
        lastModified: new Date().toISOString(),
      }], newId)
      return
    }

    setSessions(listed)
    const previousSessionId = currentSessionIdRef.current
    const active = listed.some((session) => session.id === previousSessionId)
      ? previousSessionId
      : listed[0].id
    setCurrentSessionId(active)
    await loadHistory(active)
    publishState(listed, active)
  }, [createSession, listSessions, loadHistory, publishState, sessionBootstrap])

  useEffect(() => {
    let disposed = false

    refreshSessions().catch((err) => {
      if (disposed) return
      setError(err instanceof Error ? err.message : String(err))
    })

    const unsubscribe = subscribePiSessionActions(panelId, {
      onSwitch: (sessionId) => {
        switchSession(sessionId).catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
        })
      },
      onNew: () => {
        createSession().catch((err) => {
          setError(err instanceof Error ? err.message : String(err))
        })
      },
      onRequestState: () => {
        publishState(sessionsRef.current, currentSessionIdRef.current)
      },
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [piRoutes, panelId, createSession, publishState, refreshSessions, switchSession])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, streamText, activeTools])

  const onSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || isSending || !currentSessionId) return

    setError('')
    setInput('')
    setIsSending(true)
    setStreamText('')
    setActiveTools(new Map())
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        parts: [{ type: 'text', text }],
      },
    ])

    try {
      const response = await fetchUrl(piRoutes.stream(currentSessionId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!response.ok || !response.body) {
        const payload = await readJson(response)
        throw new Error(payload?.error || `PI stream failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let doneText = ''
      let doneParts = []

      const processEvent = (rawEvent) => {
        const lines = rawEvent.split('\n')
        let eventType = 'message'
        const dataLines = []

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }

        if (dataLines.length === 0) return
        let payload = {}
        try {
          payload = JSON.parse(dataLines.join('\n'))
        } catch {
          payload = { text: dataLines.join('\n') }
        }

        if (eventType === 'delta') {
          doneText = String(payload?.text || '')
          setStreamText(doneText)
          return
        }
        if (eventType === 'tool_start') {
          setActiveTools((prev) => {
            const next = new Map(prev)
            next.set(payload.toolCallId, {
              toolName: payload.toolName || '',
              args: payload.args || {},
              status: 'running',
              result: null,
            })
            return next
          })
          return
        }
        if (eventType === 'tool_end') {
          setActiveTools((prev) => {
            const next = new Map(prev)
            next.set(payload.toolCallId, {
              ...(prev.get(payload.toolCallId) || {}),
              toolName: payload.toolName || '',
              status: 'complete',
              result: payload.result || null,
              isError: payload.isError || false,
            })
            return next
          })
          return
        }
        if (eventType === 'done') {
          doneText = String(payload?.text || doneText || '')
          doneParts = Array.isArray(payload?.parts) ? payload.parts : []
          setStreamText('')

          // Build final parts from the done event + resolved tool results
          const finalParts = buildFinalParts(doneText, doneParts, activeToolsRef.current)

          if (doneText.trim() || finalParts.length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: doneText,
                parts: finalParts,
              },
            ])
          }
          setActiveTools(new Map())
          return
        }
        if (eventType === 'error') {
          setError(String(payload?.error || 'PI stream failed'))
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        chunks.forEach(processEvent)
      }

      if (buffer.trim()) {
        processEvent(buffer)
      }

      const latestSessions = await listSessions()
      setSessions(latestSessions)
      publishState(latestSessions, currentSessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSending(false)
      setStreamText('')
      setActiveTools(new Map())
    }
  }, [currentSessionId, input, isSending, listSessions, piRoutes, publishState])

  // Keep a ref to activeTools so the done handler can read the latest state
  const activeToolsRef = useRef(new Map())
  useEffect(() => {
    activeToolsRef.current = activeTools
  }, [activeTools])

  // Render active (in-flight) tool cards
  const activeToolCards = useMemo(() => {
    const cards = []
    for (const [toolCallId, tool] of activeTools) {
      cards.push(
        <div key={toolCallId} className="pi-backend-tool-card">
          {renderToolPart({
            name: tool.toolName,
            input: tool.args,
            output: tool.result?.text || '',
            status: tool.status,
            error: tool.isError ? (tool.result?.text || 'Tool failed') : undefined,
          })}
        </div>,
      )
    }
    return cards
  }, [activeTools])

  return (
    <div className="pi-backend-chat" data-testid="pi-backend-app">
      <div className="pi-backend-messages" ref={listRef}>
        {messages.map((message) => (
          <div key={message.id} className={`pi-backend-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
            {renderMessageContent(message)}
          </div>
        ))}
        {activeToolCards.length > 0 && (
          <div className="pi-backend-row is-assistant">
            {activeToolCards}
          </div>
        )}
        {streamText
          ? (
            <div className="pi-backend-row is-assistant">
              <div className="pi-backend-bubble is-streaming">{streamText}</div>
            </div>
            )
          : null}
      </div>
      <div className="pi-backend-composer">
        <textarea
          className="pi-backend-input"
          rows={2}
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary pi-backend-send"
          disabled={!input.trim() || isSending || !currentSessionId}
          onClick={onSubmit}
        >
          <SendHorizontal size={14} aria-hidden="true" />
          <span>{isSending ? 'Sending…' : 'Send'}</span>
        </button>
      </div>
      {error
        ? <div className="pi-backend-error" data-testid="pi-backend-error">{error}</div>
        : null}
    </div>
  )
}

/**
 * Build the final parts array for a completed assistant message.
 * Merges text-only parts from the done event with resolved tool results
 * from the active tools map.
 */
function buildFinalParts(doneText, doneParts, toolsMap) {
  const parts = []

  // Add structured parts from the done event (text + tool_use)
  for (const part of doneParts) {
    if (part.type === 'text') {
      parts.push(part)
    } else if (part.type === 'tool_use') {
      const resolved = toolsMap.get(part.toolCallId)
      parts.push({
        ...part,
        status: resolved ? 'complete' : part.status,
        output: resolved?.result?.text || '',
        isError: resolved?.isError || false,
      })
    }
  }

  // If no structured parts were provided, fall back to plain text
  if (parts.length === 0 && doneText.trim()) {
    parts.push({ type: 'text', text: doneText })
  }

  // Add any tool results that weren't in doneParts (shouldn't happen normally)
  const coveredIds = new Set(doneParts.filter((p) => p.type === 'tool_use').map((p) => p.toolCallId))
  for (const [toolCallId, tool] of toolsMap) {
    if (coveredIds.has(toolCallId)) continue
    parts.push({
      type: 'tool_use',
      toolCallId,
      toolName: tool.toolName,
      args: tool.args,
      status: 'complete',
      output: tool.result?.text || '',
      isError: tool.isError || false,
    })
  }

  return parts
}

/**
 * Render a message with structured parts when available, falling back to
 * plain text bubble for simple messages.
 */
function renderMessageContent(message) {
  const parts = message.parts || []
  const hasToolParts = parts.some((p) => p.type === 'tool_use')

  // Simple text-only message — use the existing bubble style
  if (!hasToolParts) {
    return <div className="pi-backend-bubble">{message.text}</div>
  }

  // Structured message — render text and tool cards
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return <div key={`text-${i}`} className="pi-backend-bubble">{part.text}</div>
        }
        if (part.type === 'tool_use') {
          return (
            <div key={part.toolCallId || `tool-${i}`} className="pi-backend-tool-card">
              {renderToolPart({
                name: part.toolName || part.name,
                input: part.args || part.input || {},
                output: part.output || (part.result?.text) || '',
                status: part.status || 'complete',
                error: part.isError ? (part.output || part.result?.text || 'Tool failed') : undefined,
              })}
            </div>
          )
        }
        return null
      })}
    </>
  )
}
