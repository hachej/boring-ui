"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PiChatState } from './pi/piChatReducer'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from './pi/remotePiSession'
import { headersContentKey, normalizedHeadersFromContentKey } from './piChatPanelUtils'
import type { UsePiSessionsOptions } from './session'

export function useExternalRemotePiSession({
  sessionId,
  agentTypeId,
  workspaceId,
  storageScope,
  apiBaseUrl,
  requestHeaders,
  fetch,
  createRemoteSession,
  remoteSessionOptions,
}: {
  sessionId?: string
  agentTypeId: string
  workspaceId?: string
  storageScope: string
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
}): RemotePiSession | undefined {
  const [session, setSession] = useState<RemotePiSession | undefined>()
  const remoteSessionOptionsRef = useRef(remoteSessionOptions)
  remoteSessionOptionsRef.current = remoteSessionOptions
  const requestHeadersKey = headersContentKey(requestHeaders)
  const stableRequestHeaders = useMemo(
    () => normalizedHeadersFromContentKey(requestHeadersKey),
    [requestHeadersKey],
  )
  const remoteSessionOptionsKey = useMemo(
    () => remoteSessionOptionsIdentity(remoteSessionOptions),
    [remoteSessionOptions],
  )
  useEffect(() => {
    if (!sessionId) {
      setSession(undefined)
      return
    }
    const next = (createRemoteSession ?? createRemotePiSession)({
      ...remoteSessionOptionsRef.current,
      sessionId,
      agentTypeId,
      workspaceId,
      storageScope,
      apiBaseUrl,
      headers: stableRequestHeaders,
      fetch,
    })
    setSession(next)
    return () => next.dispose()
  }, [agentTypeId, apiBaseUrl, createRemoteSession, fetch, remoteSessionOptionsKey, sessionId, stableRequestHeaders, storageScope, workspaceId])
  return session
}

const remoteSessionOptionObjectIds = new WeakMap<object, number>()
let remoteSessionOptionObjectSeq = 0
function remoteSessionOptionObjectIdentity(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const object = value as object
  let id = remoteSessionOptionObjectIds.get(object)
  if (!id) {
    id = ++remoteSessionOptionObjectSeq
    remoteSessionOptionObjectIds.set(object, id)
  }
  return String(id)
}

function remoteSessionOptionsIdentity(options: UsePiSessionsOptions['remoteSessionOptions']): string {
  if (!options) return '{}'
  return JSON.stringify({
    autoStart: options.autoStart,
    requestTimeoutMs: options.requestTimeoutMs,
    onEvent: remoteSessionOptionObjectIdentity(options.onEvent),
    storeOptions: remoteSessionOptionObjectIdentity(options.storeOptions),
    setTimeoutFn: remoteSessionOptionObjectIdentity(options.setTimeoutFn),
    clearTimeoutFn: remoteSessionOptionObjectIdentity(options.clearTimeoutFn),
    reconnect: options.reconnect ? {
      baseMs: options.reconnect.baseMs,
      maxMs: options.reconnect.maxMs,
      jitterRatio: options.reconnect.jitterRatio,
      random: remoteSessionOptionObjectIdentity(options.reconnect.random),
    } : undefined,
    debug: options.debug ? {
      largeStateWarningBytes: options.debug.largeStateWarningBytes,
      largeStateWarningMessages: options.debug.largeStateWarningMessages,
      onWarning: remoteSessionOptionObjectIdentity(options.debug.onWarning),
    } : undefined,
  })
}

export function useRemotePiSessionState(session: RemotePiSession | undefined): PiChatState | undefined {
  return useSyncExternalStore(
    useCallback((listener) => session?.subscribe(listener) ?? (() => {}), [session]),
    useCallback(() => session?.getState(), [session]),
    useCallback(() => session?.getState(), [session]),
  )
}
