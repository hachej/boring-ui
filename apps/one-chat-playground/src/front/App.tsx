import { useEffect, useState } from 'react'
import { Resizer, useChatWidth } from './Resizer'
import { ChatPanel as PiChatPanel } from '@hachej/boring-agent/front'

import { Stage } from './Stage'
import { resolvePinnedSessionId } from './session'
import { useStage } from './useStage'

const AGENT_TYPE_ID = 'default'

declare global {
  interface Window {
    __ONE_CHAT_BASE_URL__?: string
  }
}

/**
 * One chat, one screen. No workbench, no tabs, no session list — the user has
 * exactly one conversation and exactly one app in front of them.
 */
export function App() {
  const stage = useStage()
  const chatWidth = useChatWidth()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const baseUrl = window.__ONE_CHAT_BASE_URL__ ?? 'http://127.0.0.1:5321/'

  useEffect(() => {
    let cancelled = false
    void resolvePinnedSessionId(AGENT_TYPE_ID)
      .then((id) => {
        if (!cancelled) setSessionId(id)
      })
      .catch((error: unknown) => {
        if (!cancelled) setSessionError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="one-chat-shell"
      data-testid="one-chat-shell"
      data-resizing={chatWidth.resizing ? "" : undefined}
      style={{ ["--one-chat-chat-width" as string]: `${chatWidth.width}px` }}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col bg-background max-[720px]:border-b max-[720px]:border-border/60"
        data-testid="one-chat-chat"
      >
        {sessionError ? (
          <p className="m-4 text-[13px] text-muted-foreground" role="alert">{sessionError}</p>
        ) : null}
        {sessionId ? (
          <PiChatPanel
            agentTypeId={AGENT_TYPE_ID}
            sessionId={sessionId}
            storageScope="one-chat"
            renderMode="messages-only"
            chrome={false}
            debug={false}
            showSessions={false}
            thinkingControl={false}
            hideComposerSettings
            hotReloadEnabled={false}
            serverResourcesEnabled={false}
            suggestions={[]}
            emptyPlacement="default"
            emptyState={{
              // Empty string suppresses the "New session" eyebrow — session
              // bookkeeping is not this user's concern.
              eyebrow: '',
              title: 'What would you like to change?',
              description: 'Ask in your own words. Your app is on the right.',
            }}
            composerPlaceholder="Tell me what to change…"
            className="h-full"
          />
        ) : null}
      </div>
      <Resizer width={chatWidth.width} onChange={chatWidth.apply} onResizingChange={chatWidth.setResizing} />
      <Stage baseUrl={baseUrl} sheet={stage.sheet} onBackToApp={stage.clearSheet} />
    </div>
  )
}

export default App
