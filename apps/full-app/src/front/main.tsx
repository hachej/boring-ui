import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatPanel } from '@boring/agent'
import { useSessions } from '@boring/agent/front'
import { CoreWorkspaceAgentFront } from '@boring/core/app/front'

import '@boring/core/theme.css'
import '@boring/workspace/globals.css'
import '@boring/agent/front/styles.css'
import './app.css'

type UseSessionsOptions = Parameters<typeof useSessions>[0]
type SessionsApi = ReturnType<typeof useSessions>

function useFullAppSessions(options: UseSessionsOptions): SessionsApi {
  const sessionApi = useSessions(options)

  useEffect(() => {
    if (sessionApi.loading || sessionApi.sessions.length > 0) return
    void sessionApi.create({ title: 'New session' })
  }, [sessionApi.loading, sessionApi.sessions.length, sessionApi.create])

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
