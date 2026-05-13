import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileUIPart, UIMessage } from 'ai'

const STORAGE_FOLLOWUP_SEQ_PREFIX = 'boring-agent:followup-seq:'
const MAX_FOLLOWUP_POST_ATTEMPTS = 5

function nextStoredFollowUpSeq(sessionId: string): number {
  const key = `${STORAGE_FOLLOWUP_SEQ_PREFIX}${sessionId}`
  try {
    const current = Number(globalThis.localStorage?.getItem(key) ?? '0')
    const next = Number.isFinite(current) ? current + 1 : 1
    globalThis.localStorage?.setItem(key, String(next))
    return next
  } catch {
    return Date.now()
  }
}

export type PendingFollowUp = {
  id: string
  sessionId: string
  text: string
  files: FileUIPart[]
  serverMessage: string
  attachments: Array<{ filename?: string; mediaType?: string; url?: string }>
  posted: boolean
  consumed: boolean
  clientNonce: string
  clientSeq: number
  postAttempts: number
}

export type ProjectedFollowUpMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  files?: FileUIPart[]
  status: 'queued' | 'streaming' | 'done'
}

export function useNativeFollowUpQueue({
  sessionId,
  status,
  requestHeaders,
  stop,
}: {
  sessionId: string
  status: string
  requestHeaders?: Record<string, string>
  stop: () => void
}) {
  const [pendingMessages, setPendingMessages] = useState<PendingFollowUp[]>([])
  const pendingMessagesRef = useRef<PendingFollowUp[]>([])
  const [projectedFollowUps, setProjectedFollowUps] = useState<ProjectedFollowUpMessage[]>([])
  const projectedFollowUpsRef = useRef<ProjectedFollowUpMessage[]>([])
  const activeProjectedAssistantRef = useRef<string | null>(null)
  const lastConsumedProjectedUserRef = useRef<string | null>(null)
  const followUpPostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followUpPostInFlightRef = useRef(false)
  const postPendingFollowUpsRef = useRef<() => void>(() => {})
  const consumedFollowUpRef = useRef<{ text: string; files: FileUIPart[] } | null>(null)

  const updatePendingMessages = useCallback((updater: (items: PendingFollowUp[]) => PendingFollowUp[]) => {
    const next = updater(pendingMessagesRef.current)
    pendingMessagesRef.current = next
    setPendingMessages(next)
  }, [])

  const updateProjectedFollowUps = useCallback((updater: (items: ProjectedFollowUpMessage[]) => ProjectedFollowUpMessage[]) => {
    const next = updater(projectedFollowUpsRef.current)
    projectedFollowUpsRef.current = next
    setProjectedFollowUps(next)
  }, [])

  const clearLocal = useCallback(() => {
    consumedFollowUpRef.current = null
    pendingMessagesRef.current = []
    projectedFollowUpsRef.current = []
    activeProjectedAssistantRef.current = null
    lastConsumedProjectedUserRef.current = null
    if (followUpPostTimerRef.current) clearTimeout(followUpPostTimerRef.current)
    followUpPostTimerRef.current = null
    followUpPostInFlightRef.current = false
    setPendingMessages([])
    setProjectedFollowUps([])
  }, [])

  const previousSessionIdRef = useRef(sessionId)
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) return
    previousSessionIdRef.current = sessionId
    clearLocal()
  }, [sessionId, clearLocal])

  const postPendingFollowUps = useCallback(() => {
    if (followUpPostInFlightRef.current) return
    followUpPostInFlightRef.current = true
    void (async () => {
      let shouldContinue = true
      try {
        while (true) {
          const pending = pendingMessagesRef.current.find((item) => item.sessionId === sessionId && !item.posted)
          if (!pending) return
          updatePendingMessages((items) => items.map((item) => item.id === pending.id ? { ...item, posted: true } : item))
          try {
            const res = await fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/followup`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...requestHeaders,
              },
              body: JSON.stringify({
                message: pending.serverMessage,
                displayText: pending.text,
                attachments: pending.attachments,
                clientNonce: pending.clientNonce,
                clientSeq: pending.clientSeq,
              }),
            })
            if (!res.ok) throw new Error(`follow-up rejected: ${res.status}`)
          } catch {
            shouldContinue = false
            const nextAttempts = pending.postAttempts + 1
            updatePendingMessages((items) => items.map((item) => item.id === pending.id ? { ...item, posted: false, postAttempts: nextAttempts } : item))
            if (nextAttempts < MAX_FOLLOWUP_POST_ATTEMPTS) {
              const delayMs = Math.min(1000 * 2 ** (nextAttempts - 1), 8000)
              if (followUpPostTimerRef.current) clearTimeout(followUpPostTimerRef.current)
              followUpPostTimerRef.current = setTimeout(() => {
                postPendingFollowUpsRef.current()
              }, delayMs)
            }
            return
          }
        }
      } finally {
        followUpPostInFlightRef.current = false
        if (shouldContinue && pendingMessagesRef.current.some((item) => item.sessionId === sessionId && !item.posted)) {
          postPendingFollowUps()
        }
      }
    })()
  }, [sessionId, requestHeaders, updatePendingMessages])
  postPendingFollowUpsRef.current = postPendingFollowUps

  const queueFollowUp = useCallback((input: {
    text: string
    files: FileUIPart[]
    serverMessage: string
    attachments: Array<{ filename?: string; mediaType?: string; url?: string }>
  }) => {
    const nextPending: PendingFollowUp = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      sessionId,
      text: input.text,
      files: input.files ?? [],
      serverMessage: input.serverMessage,
      attachments: input.attachments,
      posted: false,
      consumed: false,
      clientNonce: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}-nonce`,
      clientSeq: nextStoredFollowUpSeq(sessionId),
      postAttempts: 0,
    }
    updatePendingMessages((items) => [...items, nextPending])
    updateProjectedFollowUps((items) => [...items, {
      id: nextPending.id,
      role: 'user',
      text: nextPending.text,
      files: nextPending.files,
      status: 'queued',
    }])
    if (status === 'streaming') {
      queueMicrotask(() => postPendingFollowUps())
    } else {
      if (followUpPostTimerRef.current) clearTimeout(followUpPostTimerRef.current)
      followUpPostTimerRef.current = setTimeout(() => {
        postPendingFollowUps()
      }, 1000)
    }
  }, [sessionId, status, postPendingFollowUps, updatePendingMessages, updateProjectedFollowUps])

  const handleData = useCallback((part: unknown) => {
    const typed = part as { type?: string; data?: Record<string, unknown> }
    if (typed.type === 'data-followup-consumed') {
      const serverText = typeof typed.data?.text === 'string' ? typed.data.text : ''
      const pending = pendingMessagesRef.current.find((item) => !item.consumed && (item.serverMessage === serverText || item.text === serverText))
        ?? pendingMessagesRef.current.find((item) => !item.consumed)
      consumedFollowUpRef.current = pending
        ? { text: pending.text, files: pending.files }
        : serverText
          ? { text: serverText, files: [] }
          : null
      if (pending) {
        lastConsumedProjectedUserRef.current = pending.id
        updatePendingMessages((items) => items.map((item) => item.id === pending.id ? { ...item, consumed: true } : item))
        updateProjectedFollowUps((items) => items.map((item) => item.id === pending.id ? { ...item, status: 'done' } : item))
      }
    } else if (typed.type === 'data-pi-message-start') {
      const role = typed.data?.role
      const messageId = typeof typed.data?.messageId === 'string' ? typed.data.messageId : undefined
      if (role === 'assistant' && messageId && pendingMessagesRef.current.some((item) => item.consumed)) {
        activeProjectedAssistantRef.current = messageId
        updateProjectedFollowUps((items) => {
          if (items.some((item) => item.id === messageId)) return items
          const nextAssistant: ProjectedFollowUpMessage = { id: messageId, role: 'assistant', text: '', status: 'streaming' }
          const afterUserId = lastConsumedProjectedUserRef.current
          const userIndex = afterUserId ? items.findIndex((item) => item.id === afterUserId) : -1
          if (userIndex < 0) return [...items, nextAssistant]
          return [...items.slice(0, userIndex + 1), nextAssistant, ...items.slice(userIndex + 1)]
        })
      }
    } else if (typed.type === 'data-pi-message-delta') {
      const messageId = typeof typed.data?.messageId === 'string' ? typed.data.messageId : activeProjectedAssistantRef.current
      const delta = typeof typed.data?.delta === 'string' ? typed.data.delta : ''
      if (messageId && delta && projectedFollowUpsRef.current.some((item) => item.id === messageId)) {
        updateProjectedFollowUps((items) => items.map((item) => item.id === messageId ? { ...item, text: item.text + delta } : item))
      }
    } else if (typed.type === 'data-pi-message-end') {
      const role = typed.data?.role
      const messageId = typeof typed.data?.messageId === 'string' ? typed.data.messageId : activeProjectedAssistantRef.current
      const text = typeof typed.data?.text === 'string' ? typed.data.text : ''
      if (role === 'assistant' && messageId && projectedFollowUpsRef.current.some((item) => item.id === messageId)) {
        updateProjectedFollowUps((items) => items.map((item) => item.id === messageId ? { ...item, text: item.text || text, status: 'done' } : item))
        if (activeProjectedAssistantRef.current === messageId) activeProjectedAssistantRef.current = null
      }
    }
  }, [updatePendingMessages, updateProjectedFollowUps])

  useEffect(() => {
    if (status !== 'streaming') return
    if (!pendingMessagesRef.current.some((item) => !item.posted)) return
    postPendingFollowUps()
  }, [status, postPendingFollowUps])

  const prevStatusForQueue = useRef(status)
  useEffect(() => {
    const prev = prevStatusForQueue.current
    prevStatusForQueue.current = status
    if (status !== 'ready') return
    if (prev !== 'streaming' && prev !== 'submitted') return
    const consumed = consumedFollowUpRef.current
    if (!consumed) return
    consumedFollowUpRef.current = null
    if (followUpPostTimerRef.current) clearTimeout(followUpPostTimerRef.current)
    followUpPostTimerRef.current = null
    updatePendingMessages((items) => items.filter((item) => !item.consumed))
    projectedFollowUpsRef.current = []
    activeProjectedAssistantRef.current = null
    lastConsumedProjectedUserRef.current = null
    setProjectedFollowUps([])
  }, [status, updatePendingMessages])

  const clearFollowUps = useCallback(() => {
    clearLocal()
    fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/followup`, {
      method: 'DELETE',
      headers: requestHeaders,
    }).catch(() => {})
  }, [clearLocal, sessionId, requestHeaders])

  const stopAndClearFollowUps = useCallback(() => {
    stop()
    clearFollowUps()
  }, [stop, clearFollowUps])

  const projectedTailMessages = useMemo<UIMessage[]>(() =>
    projectedFollowUps.map((item) => ({
      id: item.id,
      role: item.role,
      parts: [
        ...(item.files ?? []),
        { type: 'text' as const, text: item.text },
      ],
    })),
  [projectedFollowUps])

  const projectedStatusById = useMemo(() => {
    const map = new Map<string, ProjectedFollowUpMessage['status']>()
    for (const item of projectedFollowUps) map.set(item.id, item.status)
    return map
  }, [projectedFollowUps])

  return {
    pendingMessages,
    projectedFollowUps,
    projectedTailMessages,
    projectedStatusById,
    queueFollowUp,
    handleData,
    clearFollowUps,
    stopAndClearFollowUps,
  }
}
