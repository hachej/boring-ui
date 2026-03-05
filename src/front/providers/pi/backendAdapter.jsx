import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import {
  publishPiSessionState,
  subscribePiSessionActions,
} from './sessionBus'
import { fetchJsonUrl, fetchUrl } from '../../utils/transport'
import { createPiRoutes } from './routes'

const EMPTY_STATE = { currentSessionId: '', sessions: [] }

const toDisplayMessage = (message) => {
  const role = message?.role === 'assistant' ? 'assistant' : 'user'
  const text = String(message?.text || '').trim()
  if (!text) return null
  return {
    id: String(message?.id || `${role}-${Math.random().toString(36).slice(2, 10)}`),
    role,
    text,
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
    publishState(nextSessions, created.id)
    return created.id
  }, [piRoutes, publishState])

  const switchSession = useCallback(async (sessionId) => {
    if (!sessionId) return
    setCurrentSessionId(sessionId)
    setStreamText('')
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
    if (!piRoutes.isConfigured) {
      setError('PI backend URL is not configured.')
      publishPiSessionState(panelId, EMPTY_STATE)
      return undefined
    }

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
  }, [messages, streamText])

  const onSubmit = useCallback(async () => {
    const text = input.trim()
    if (!text || isSending || !currentSessionId) return

    setError('')
    setInput('')
    setIsSending(true)
    setStreamText('')
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
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
        if (eventType === 'done') {
          doneText = String(payload?.text || doneText || '')
          setStreamText('')
          if (doneText.trim()) {
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                text: doneText,
              },
            ])
          }
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
    }
  }, [currentSessionId, input, isSending, listSessions, piRoutes, publishState])

  return (
    <div className="pi-backend-chat" data-testid="pi-backend-app">
      <div className="pi-backend-messages" ref={listRef}>
        {messages.map((message) => (
          <div key={message.id} className={`pi-backend-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
            <div className="pi-backend-bubble">{message.text}</div>
          </div>
        ))}
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
