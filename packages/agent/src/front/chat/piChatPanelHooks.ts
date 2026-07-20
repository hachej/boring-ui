"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PiChatState } from './pi/piChatReducer'
import type { SessionSummary } from '../../shared/session'
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
  nativeSessionStartEnabled = false,
  onNativeSessionAdopt,
}: {
  sessionId?: string
  workspaceId?: string
  storageScope: string
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
  nativeSessionStartEnabled?: boolean
  onNativeSessionAdopt?: (session: SessionSummary) => void
}): RemotePiSession | undefined {
  const [session, setSession] = useState<RemotePiSession | undefined>()
  const remoteSessionOptionsRef = useRef(remoteSessionOptions)
  remoteSessionOptionsRef.current = remoteSessionOptions
  const onNativeSessionAdoptRef = useRef(onNativeSessionAdopt)
  onNativeSessionAdoptRef.current = onNativeSessionAdopt
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
      ...(nativeSessionStartEnabled ? { autoStart: false, nativeFirstPrompt: { onAdopt: (native) => onNativeSessionAdoptRef.current?.(native) } } : {}),
      workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch,
    })
    setSession(next)
    return () => next.dispose()
  }, [apiBaseUrl, createRemoteSession, fetch, nativeSessionStartEnabled, remoteSessionOptionsKey, requestHeaders, sessionId, storageScope, workspaceId])
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
