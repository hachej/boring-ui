import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileUIPart, UIMessage } from 'ai'

const STORAGE_FOLLOWUP_SEQ_PREFIX = 'boring-agent:followup-seq:'
const STORAGE_FOLLOWUP_QUEUE_PREFIX = 'boring-agent:followup-queue:'
const MAX_FOLLOWUP_POST_ATTEMPTS = 5

function workspaceScopeFromHeaders(headers?: Record<string, string>): string {
  return headers?.['x-boring-workspace-id'] ?? headers?.['X-Boring-Workspace-Id'] ?? 'global'
}

function scopedStorageKey(prefix: string, storageScope: string, sessionId: string): string {
  return `${prefix}${encodeURIComponent(storageScope)}:${encodeURIComponent(sessionId)}`
}

function nextStoredFollowUpSeq(storageScope: string, sessionId: string): number {
  const key = scopedStorageKey(STORAGE_FOLLOWUP_SEQ_PREFIX, storageScope, sessionId)
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

function followUpQueueStorageKey(storageScope: string, sessionId: string): string {
  return scopedStorageKey(STORAGE_FOLLOWUP_QUEUE_PREFIX, storageScope, sessionId)
}

function isPendingFollowUp(value: unknown, sessionId: string): value is PendingFollowUp {
  const item = value as PendingFollowUp
  return Boolean(
    item &&
    item.sessionId === sessionId &&
    typeof item.id === 'string' &&
    typeof item.text === 'string' &&
    typeof item.serverMessage === 'string' &&
    typeof item.clientNonce === 'string' &&
    typeof item.clientSeq === 'number' &&
    typeof item.postAttempts === 'number' &&
    Array.isArray(item.files) &&
    Array.isArray(item.attachments) &&
    typeof item.posted === 'boolean' &&
    typeof item.consumed === 'boolean',
  )
}

function pendingToProjected(item: PendingFollowUp): ProjectedFollowUpMessage {
  return {
    id: item.id,
    role: 'user',
    text: item.text,
    files: item.files,
    status: item.consumed ? 'done' : 'queued',
  }
}

function readStoredFollowUps(storageScope: string, sessionId: string): PendingFollowUp[] {
  try {
    const raw = globalThis.localStorage?.getItem(followUpQueueStorageKey(storageScope, sessionId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PendingFollowUp => isPendingFollowUp(item, sessionId))
  } catch {
    return []
  }
}

function writeStoredFollowUps(storageScope: string, sessionId: string, items: PendingFollowUp[]): void {
  try {
    const scoped = items.filter((item) => item.sessionId === sessionId && !item.consumed)
    const storage = globalThis.localStorage
    if (!storage) return
    const key = followUpQueueStorageKey(storageScope, sessionId)
    if (scoped.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(scoped))
  } catch { /* quota exceeded / storage unavailable: keep in-memory only */ }
}

export function usePiNativeFollowUpQueue({
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
  const storageScope = workspaceScopeFromHeaders(requestHeaders)
  const [pendingMessages, setPendingMessages] = useState<PendingFollowUp[]>(() => readStoredFollowUps(storageScope, sessionId))
  const pendingMessagesRef = useRef<PendingFollowUp[]>(pendingMessages)
  const [projectedFollowUps, setProjectedFollowUps] = useState<ProjectedFollowUpMessage[]>(() => pendingMessages.map(pendingToProjected))
  const projectedFollowUpsRef = useRef<ProjectedFollowUpMessage[]>(projectedFollowUps)
  const activeProjectedAssistantRef = useRef<string | null>(null)
  const lastConsumedProjectedUserRef = useRef<string | null>(null)
  const followUpPostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followUpPostInFlightRef = useRef(false)
  const postPendingFollowUpsRef = useRef<() => void>(() => {})
  const consumedFollowUpRef = useRef<{ text: string; files: FileUIPart[] } | null>(null)
  const activeStorageRef = useRef({ storageScope, sessionId })
  activeStorageRef.current = { storageScope, sessionId }

  const updatePendingMessages = useCallback((updater: (items: PendingFollowUp[]) => PendingFollowUp[]) => {
    const next = updater(pendingMessagesRef.current)
    pendingMessagesRef.current = next
    writeStoredFollowUps(storageScope, sessionId, next)
    setPendingMessages(next)
  }, [storageScope, sessionId])

  const updateProjectedFollowUps = useCallback((updater: (items: ProjectedFollowUpMessage[]) => ProjectedFollowUpMessage[]) => {
    const next = updater(projectedFollowUpsRef.current)
    projectedFollowUpsRef.current = next
    setProjectedFollowUps(next)
  }, [])

  const clearRuntimeState = useCallback(() => {
    consumedFollowUpRef.current = null
    activeProjectedAssistantRef.current = null
    lastConsumedProjectedUserRef.current = null
    if (followUpPostTimerRef.current) clearTimeout(followUpPostTimerRef.current)
    followUpPostTimerRef.current = null
    followUpPostInFlightRef.current = false
  }, [])

  const loadLocalForScope = useCallback((nextStorageScope: string, nextSessionId: string) => {
    clearRuntimeState()
    const restored = readStoredFollowUps(nextStorageScope, nextSessionId)
    const projected = restored.map(pendingToProjected)
    pendingMessagesRef.current = restored
    projectedFollowUpsRef.current = projected
    setPendingMessages(restored)
    setProjectedFollowUps(projected)
  }, [clearRuntimeState])

  const clearLocal = useCallback(() => {
    clearRuntimeState()
    pendingMessagesRef.current = []
    projectedFollowUpsRef.current = []
    writeStoredFollowUps(storageScope, sessionId, [])
    setPendingMessages([])
    setProjectedFollowUps([])
  }, [clearRuntimeState, storageScope, sessionId])

  const previousStorageRef = useRef({ storageScope, sessionId })
  useEffect(() => {
    if (previousStorageRef.current.storageScope === storageScope && previousStorageRef.current.sessionId === sessionId) return
    previousStorageRef.current = { storageScope, sessionId }
    loadLocalForScope(storageScope, sessionId)
  }, [storageScope, sessionId, loadLocalForScope])

  // Clean up timers on unmount to prevent stale retries after component
  // unmounts (e.g. when switching sessions).
  useEffect(() => {
    return () => {
      if (followUpPostTimerRef.current) {
        clearTimeout(followUpPostTimerRef.current)
        followUpPostTimerRef.current = null
      }
    }
  }, [])

  const postPendingFollowUps = useCallback(() => {
    if (followUpPostInFlightRef.current) return
    const postStorageScope = storageScope
    const postSessionId = sessionId
    const isActiveScope = () => activeStorageRef.current.storageScope === postStorageScope && activeStorageRef.current.sessionId === postSessionId
    if (!isActiveScope()) return
    followUpPostInFlightRef.current = true
    void (async () => {
      let shouldContinue = true
      try {
        while (true) {
          if (!isActiveScope()) return
          const pending = pendingMessagesRef.current.find((item) => item.sessionId === postSessionId && !item.posted)
          if (!pending) return
          try {
            const res = await fetch(`/api/v1/agent/chat/${encodeURIComponent(postSessionId)}/followup`, {
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
            if (!isActiveScope()) return
            updatePendingMessages((items) => items.map((item) => item.id === pending.id ? { ...item, posted: true } : item))
          } catch {
            shouldContinue = false
            if (!isActiveScope()) return
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
        if (isActiveScope()) {
          followUpPostInFlightRef.current = false
          if (shouldContinue && pendingMessagesRef.current.some((item) => item.sessionId === postSessionId && !item.posted)) {
            postPendingFollowUps()
          }
        }
      }
    })()
  }, [storageScope, sessionId, requestHeaders, updatePendingMessages])
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
      clientSeq: nextStoredFollowUpSeq(storageScope, sessionId),
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
  }, [storageScope, sessionId, status, postPendingFollowUps, updatePendingMessages, updateProjectedFollowUps])

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

  const deleteFollowUp = useCallback((id: string) => {
    const pending = pendingMessagesRef.current.find((item) => item.id === id)
    updatePendingMessages((items) => items.filter((item) => item.id !== id))
    updateProjectedFollowUps((items) => items.filter((item) => item.id !== id))
    if (!pending) return
    const params = new URLSearchParams()
    params.set('clientNonce', pending.clientNonce)
    params.set('clientSeq', String(pending.clientSeq))
    fetch(`/api/v1/agent/chat/${encodeURIComponent(sessionId)}/followup?${params.toString()}`, {
      method: 'DELETE',
      headers: requestHeaders,
    }).catch(() => {})
  }, [sessionId, requestHeaders, updatePendingMessages, updateProjectedFollowUps])

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
    deleteFollowUp,
    handleData,
    clearFollowUps,
    stopAndClearFollowUps,
  }
}
