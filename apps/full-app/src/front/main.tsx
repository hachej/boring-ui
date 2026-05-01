import { useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '@boring/agent'
import { useSessions } from '@boring/agent/front'
import { CoreWorkspaceAgentFront } from '@boring/core/app/front'
import { seedShowcase } from './showcaseMessages'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/front/styles.css'
import './app.css'

function isShowcaseRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('showcase') === '1'
}

type UseSessionsOptions = Parameters<typeof useSessions>[0]
type SessionsApi = ReturnType<typeof useSessions>

function useFullAppSessions(options: UseSessionsOptions): SessionsApi {
  const sessionApi = useSessions(options)
  const showcase = useMemo(isShowcaseRoute, [])

  useEffect(() => {
    if (sessionApi.loading || sessionApi.sessions.length > 0) return
    void sessionApi.create({
      title: showcase ? 'Showcase conversation' : 'New session',
    })
  }, [showcase, sessionApi.loading, sessionApi.sessions.length, sessionApi.create])

  useEffect(() => {
    if (!showcase || !sessionApi.activeSessionId) return
    seedShowcase(sessionApi.activeSessionId)
  }, [showcase, sessionApi.activeSessionId])

  return sessionApi
}

createRoot(document.getElementById('root')!).render(
  <CoreWorkspaceAgentFront
    chatPanel={ChatPanel}
    useSessions={useFullAppSessions}
    apiBaseUrl=""
    apiTimeout={10_000}
    persistenceEnabled
    providerStorageKey="boring-ui-v2:layout:full-app"
  />,
)
