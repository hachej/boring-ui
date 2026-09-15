import { ChatPanel as PiChatPanel } from '@hachej/boring-agent/front'

import { Stage } from './Stage'
import { pinnedSessionId } from './session'
import { useStage } from './useStage'

const SESSION_ID = pinnedSessionId()

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
  const baseUrl = window.__ONE_CHAT_BASE_URL__ ?? 'http://127.0.0.1:5321/'

  return (
    <div className="one-chat-shell" data-testid="one-chat-shell">
      <div
        className="min-h-0 min-w-0 border-r border-border/60 bg-background max-[720px]:border-r-0 max-[720px]:border-b"
        data-testid="one-chat-chat"
      >
        <PiChatPanel
          agentTypeId="default"
          sessionId={SESSION_ID}
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
            title: 'What would you like to change?',
            description: 'Ask in your own words. Your app is on the right.',
          }}
          composerPlaceholder="Tell me what to change…"
          className="h-full"
        />
      </div>
      <Stage baseUrl={baseUrl} sheet={stage.sheet} onBackToApp={stage.clearSheet} />
    </div>
  )
}

export default App
