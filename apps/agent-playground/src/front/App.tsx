import './app.css'
import { useCallback, useEffect, useState } from 'react'
import { ChatPanel as PiChatPanel } from '@hachej/boring-agent/front'
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from '@hachej/boring-agent/shared'
import { Showcase } from '../Showcase'

type Theme = 'light' | 'dark'
const THEME_STORAGE_KEY = 'agent-playground:theme:v2'

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'light'
}

type PluginReloadPayload = { reloaded?: boolean }

function useStandalonePluginReload() {
  return useCallback(async () => {
    const response = await fetch('/api/v1/agent/reload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) return `reload failed (${response.status})`
    const payload = await response.json().catch(() => ({})) as PluginReloadPayload
    window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: payload }))
    return payload.reloaded ? 'Agent plugins reloaded.' : 'Agent plugins will reload on the next message.'
  }, [])
}

export function App() {
  const [tab, setTab] = useState<'chat' | 'showcase'>('chat')
  const [chrome, setChrome] = useState(true)
  const [debug, setDebug] = useState(true)
  const [thinkingControl, setThinkingControl] = useState(true)
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())
  const reloadAgentPlugins = useStandalonePluginReload()
  const showSessionsParam = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('showSessions') : null
  const [showSessions, setShowSessions] = useState(showSessionsParam === '1')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return (
    <div className="flex h-screen w-screen flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 py-2 text-[12px]">
        <div className="flex items-center gap-0.5 rounded-md border border-border/50 p-0.5">
          <button type="button" onClick={() => setTab('chat')}
            className={`h-6 rounded px-2.5 text-[11px] transition-colors ${tab === 'chat' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            chat
          </button>
          <button type="button" onClick={() => setTab('showcase')}
            className={`h-6 rounded px-2.5 text-[11px] transition-colors ${tab === 'showcase' ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
            showcase
          </button>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground/70">@hachej/boring-agent · playground</span>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.currentTarget.checked)} />
            chrome
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.currentTarget.checked)} />
            debug
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showSessions} onChange={(e) => setShowSessions(e.currentTarget.checked)} />
            sessions
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={thinkingControl} onChange={(e) => setThinkingControl(e.currentTarget.checked)} />
            thinking control
          </label>
          <button type="button" className="rounded border border-border/60 px-2 py-1" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme} theme
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-background">
        {tab === 'showcase' ? (
          <div className="h-full overflow-y-auto">
            <Showcase />
          </div>
        ) : (
          <div className="agent-playground-chat-pane h-full min-w-0 border-r border-border/60 bg-background">
            <PiChatPanel
              chrome={chrome}
              thinkingControl={thinkingControl}
              debug={debug}
              showSessions={showSessions}
              nativeSessionStartEnabled
              storageScope="agent-playground"
              onReloadAgentPlugins={reloadAgentPlugins}
              className="h-full"
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default App
