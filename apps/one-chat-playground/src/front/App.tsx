import { useEffect, useMemo, useState } from 'react'
import { Resizer, useChatSize, useIsMobile } from './Resizer'
import { ChatPanel as PiChatPanel } from '@hachej/boring-agent/front'

import { QuestionCard } from './QuestionCard'
import { resolveQuestionCardState } from './askUserCard'
import { useAskUser } from './useAskUser'
import { Stage } from './Stage'
import { resolvePinnedSessionId } from './session'
import { useStage } from './useStage'

const AGENT_TYPE_ID = 'default'
/** The only tool the user sees: a question they have to answer. */
const VISIBLE_TOOLS = ['ask_user'] as const
const HIDDEN_HOST_PROMPTS = ['[system event]'] as const

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
  const mobile = useIsMobile()
  const chat = useChatSize(mobile)
  const askUser = useAskUser()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const baseUrl = window.__ONE_CHAT_BASE_URL__ ?? 'http://127.0.0.1:5321/'

  // The agent's turn is blocked on the answer, so the composer is too: one
  // question at a time, answered where it was asked.
  const composerBlockers = useMemo(
    () => askUser.pending.map((question) => ({
      id: `ask-user:${question.questionId}`,
      reason: 'ask-user.question',
      label: question.title ?? 'Answer the question above to continue.',
    })),
    [askUser.pending],
  )

  const toolRenderers = useMemo(() => ({
    ask_user: Object.assign(
      (part: { toolCallId: string; state: string; output?: unknown }) => (
        <QuestionCard
          state={resolveQuestionCardState({ call: part, pending: askUser.pending, justAnswered: askUser.justAnswered })}
          submitting={askUser.submitting !== null}
          onAnswer={(question, values) => void askUser.submit(question, values)}
        />
      ),
      { presentation: 'inline' as const },
    ),
  }), [askUser])

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
      data-resizing={chat.resizing ? "" : undefined}
      data-mobile={mobile ? "" : undefined}
      style={{
        ["--one-chat-chat-width" as string]: `${chat.width}px`,
        ["--one-chat-chat-height" as string]: `${chat.height}px`,
      }}
    >
      <div
        className="one-chat-chat flex min-h-0 min-w-0 flex-col bg-background"
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
            messagesOnlyVisibleTools={VISIBLE_TOOLS}
            messagesOnlyHiddenUserPrefixes={HIDDEN_HOST_PROMPTS}
            toolRenderers={toolRenderers}
            composerBlockers={composerBlockers}
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
      <Resizer
        size={chat.size}
        orientation={mobile ? 'horizontal' : 'vertical'}
        onChange={chat.apply}
        onReset={chat.reset}
        onResizingChange={chat.setResizing}
      />
      <Stage baseUrl={baseUrl} sheet={stage.sheet} onBackToApp={stage.clearSheet} />
    </div>
  )
}

export default App
