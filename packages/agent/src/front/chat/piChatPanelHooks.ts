"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PiChatState } from './pi/piChatReducer'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from './pi/remotePiSession'
import { remoteSessionOptionsIdentity } from './pi/remoteSessionOptionsIdentity'
import type { UsePiSessionsOptions } from './session'
import type { EphemeralSessionCoordinatorApi } from './session/ephemeralSessionCoordinator'

export function useExternalRemotePiSession({
  sessionId,
  workspaceId,
  storageScope,
  apiBaseUrl,
  requestHeaders,
  fetch,
  createRemoteSession,
  remoteSessionOptions,
  ephemeralSessionCoordinator,
  ephemeralSessionVersion = 0,
  nativeSessionStartEnabled = false,
}: {
  sessionId?: string
  workspaceId?: string
  storageScope: string
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
  ephemeralSessionCoordinator?: EphemeralSessionCoordinatorApi
  ephemeralSessionVersion?: number
  nativeSessionStartEnabled?: boolean
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
    const ephemeralPhase = nativeSessionStartEnabled ? ephemeralSessionCoordinator?.phase(sessionId) : undefined
    const adoptedNativeId = ephemeralPhase?.type === 'adopted' || ephemeralPhase?.type === 'failed'
      ? ephemeralPhase.receipt.nativeSessionId
      : undefined
    const isEphemeral = ephemeralPhase?.type === 'local' || ephemeralPhase?.type === 'starting' || ephemeralPhase?.type === 'retryable'
    const next = (createRemoteSession ?? createRemotePiSession)({
      ...remoteSessionOptionsRef.current,
      sessionId: adoptedNativeId ?? sessionId,
      workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch,
      ...(isEphemeral ? {
        autoStart: false,
        ephemeralSession: { coordinator: ephemeralSessionCoordinator!, localId: sessionId },
      } : {}),
    })
    setSession(next)
    return () => next.dispose()
  }, [apiBaseUrl, createRemoteSession, ephemeralSessionCoordinator, ephemeralSessionVersion, fetch, nativeSessionStartEnabled, remoteSessionOptionsKey, requestHeaders, sessionId, storageScope, workspaceId])
  return session
}


export function useRemotePiSessionState(session: RemotePiSession | undefined): PiChatState | undefined {
  return useSyncExternalStore(
    useCallback((listener) => session?.subscribe(listener) ?? (() => {}), [session]),
    useCallback(() => session?.getState(), [session]),
    useCallback(() => session?.getState(), [session]),
  )
}
