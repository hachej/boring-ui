"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PiChatState } from './pi/piChatReducer'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from './pi/remotePiSession'
import type { UsePiSessionsOptions } from './session'

export function useExternalRemotePiSession({
  sessionId,
  workspaceId,
  storageScope,
  apiBaseUrl,
  requestHeaders,
  fetch,
  createRemoteSession,
  remoteSessionOptions,
}: {
  sessionId?: string
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
      workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch,
    })
    setSession(next)
    return () => next.dispose()
  }, [apiBaseUrl, createRemoteSession, fetch, remoteSessionOptionsKey, requestHeaders, sessionId, storageScope, workspaceId])
  return session
}

function remoteSessionOptionsIdentity(options: UsePiSessionsOptions['remoteSessionOptions']): string {
  if (!options) return '{}'
  return JSON.stringify({
    autoStart: options.autoStart,
    requestTimeoutMs: options.requestTimeoutMs,
    reconnect: options.reconnect,
    debug: options.debug ? {
      largeStateWarningBytes: options.debug.largeStateWarningBytes,
      largeStateWarningMessages: options.debug.largeStateWarningMessages,
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
