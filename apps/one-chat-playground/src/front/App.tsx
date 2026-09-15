import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatPanel as PiChatPanel } from '@hachej/boring-agent/front'

import { ActivityStrip } from './ActivityStrip'
import { AppRail } from './AppRail'
import { QuestionCard } from './QuestionCard'
import { Resizer, useChatSize, useIsMobile } from './Resizer'
import { resolveQuestionCardState } from './askUserCard'
import { Stage } from './Stage'
import { ThemeToggle } from './ThemeToggle'
import { resolvePinnedSessionId } from './session'
import { useApps, type OneChatAppView } from './useApps'
import { useAskUser } from './useAskUser'
import { useStage } from './useStage'
import { useVisualViewport } from './useVisualViewport'

const AGENT_TYPE_ID = 'default'
const VISIBLE_TOOLS = ['ask_user'] as const
const HIDDEN_HOST_PROMPTS = ['[system event]'] as const

export function App() {
  const mobile = useIsMobile()
  const apps = useApps()

  return (
    <div className="one-chat-root" data-mobile={mobile ? '' : undefined}>
      <AppRail
        apps={apps.apps}
        activeApp={apps.activeApp}
        overlay={apps.overlay}
        mobile={mobile}
        creating={apps.creating}
        onSelect={apps.navigateTo}
        onOpenApps={() => apps.setOverlay('apps')}
        onOpenNew={() => apps.setOverlay('new')}
        onClose={apps.closeOverlay}
        onCreate={apps.create}
      />
      <main className="one-chat-workspace">
        {apps.loading ? <div className="one-chat-boot">Opening your apps…</div> : null}
        {!apps.loading && apps.activeApp ? <AppExperience key={apps.activeApp.slug} app={apps.activeApp} mobile={mobile} /> : null}
        {!apps.loading && !apps.activeApp ? (
          <div className="one-chat-no-app" data-testid="one-chat-no-app">
            <span>N</span>
            <h1>Name your next app.</h1>
            <p>One name is enough to give your colleague a clean place to begin.</p>
            <button type="button" onClick={() => apps.setOverlay('new')}>Create an app</button>
          </div>
        ) : null}
        {apps.error ? <p className="one-chat-global-error" role="alert">{apps.error}</p> : null}
      </main>
    </div>
  )
}

function AppExperience({ app, mobile }: { readonly app: OneChatAppView; readonly mobile: boolean }) {
  const stage = useStage(app.slug, mobile)
  const chat = useChatSize(mobile)
  const askUser = useAskUser(app.slug)
  const viewport = useVisualViewport()
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null)
  const activityRef = useRef(stage.activity)
  activityRef.current = stage.activity
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const handleStatus = (raw: Event) => {
      const detail = (raw as CustomEvent<{ sessionId?: string; working?: boolean }>).detail
      if (detail?.sessionId !== sessionId) return
      if (detail.working && askUser.pending.length === 0) setThinkingStartedAt((current) => current ?? Date.now())
      else setThinkingStartedAt(null)
    }
    window.addEventListener('boring:chat-session-status', handleStatus)
    window.dispatchEvent(new Event('boring:chat-session-status-request'))
    return () => window.removeEventListener('boring:chat-session-status', handleStatus)
  }, [askUser.pending.length, sessionId])

  const composerBlockers = useMemo(
    () => askUser.pending.map((question) => ({
      id: `ask-user:${question.questionId}`,
      reason: 'ask-user.question',
      label: question.title ?? 'Answer the question above to continue.',
    })),
    [askUser.pending],
  )

  useEffect(() => {
    stage.setQuestionPending(askUser.pending.length > 0)
  }, [askUser.pending.length, stage.setQuestionPending])

  const beginThinking = useCallback(() => setThinkingStartedAt(Date.now()), [])
  const clearWaitingActivity = useCallback(() => {
    setThinkingStartedAt(null)
    const clearCompletedBuilder = () => {
      if (activityRef.current?.milestone === 'done') stage.clearActivity()
    }
    clearCompletedBuilder()
    window.setTimeout(clearCompletedBuilder, 500)
  }, [stage.clearActivity])
  const onAgentData = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const event = raw as {
      type?: unknown
      role?: unknown
      kind?: unknown
      delta?: unknown
      text?: unknown
      toolName?: unknown
      final?: { role?: unknown; parts?: readonly { type?: unknown; text?: unknown }[] }
    }
    if (event.type === 'tool-call' && event.toolName === 'ask_user') {
      setThinkingStartedAt(null)
      return
    }
    const assistantStartedWithText = event.type === 'message-start'
      && event.role === 'assistant'
      && typeof event.text === 'string'
      && event.text.trim().length > 0
    const assistantTextDelta = event.type === 'message-delta'
      && event.kind === 'text'
      && typeof event.delta === 'string'
      && event.delta.trim().length > 0
    const assistantTextFinished = event.type === 'message-part-end'
      && event.kind === 'text'
      && typeof event.text === 'string'
      && event.text.trim().length > 0
    const assistantMessageFinished = event.type === 'message-end'
      && event.final?.role === 'assistant'
      && event.final.parts?.some((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim())
    if (assistantStartedWithText || assistantTextDelta || assistantTextFinished || assistantMessageFinished) clearWaitingActivity()
    if (assistantMessageFinished) stage.markAssistantMessage()
  }, [clearWaitingActivity, stage.markAssistantMessage])

  const toolRenderers = useMemo(() => ({
    ask_user: Object.assign(
      (part: { toolCallId: string; state: string; input?: unknown; output?: unknown }) => (
        <QuestionCard
          state={resolveQuestionCardState({ call: part, pending: askUser.pending, justAnswered: askUser.justAnswered })}
          submitting={askUser.submitting !== null}
          onAnswer={(question, values) => {
            beginThinking()
            void askUser.submit(question, values).catch(() => setThinkingStartedAt(null))
          }}
        />
      ),
      { presentation: 'inline' as const },
    ),
  }), [askUser, beginThinking])

  useEffect(() => {
    let cancelled = false
    setSessionId(null)
    setSessionError(null)
    void resolvePinnedSessionId(AGENT_TYPE_ID, app.slug)
      .then((id) => { if (!cancelled) setSessionId(id) })
      .catch((error: unknown) => {
        if (!cancelled) setSessionError(error instanceof Error ? error.message : String(error))
      })
    return () => { cancelled = true }
  }, [app.slug])

  const chatSurface = (
    <div className="one-chat-chat relative flex min-h-0 min-w-0 flex-col bg-background" data-testid="one-chat-chat">
      {!mobile ? <ThemeToggle /> : null}
      {sessionError ? <p className="m-4 text-[13px] text-muted-foreground" role="alert">{sessionError}</p> : null}
      {sessionId ? (
        <PiChatPanel
          agentTypeId={AGENT_TYPE_ID}
          sessionId={sessionId}
          storageScope={`one-chat:${app.slug}`}
          requestHeaders={{ 'x-one-chat-app': app.slug }}
          renderMode="messages-only"
          messagesOnlyVisibleTools={VISIBLE_TOOLS}
          messagesOnlyHideCopyActions
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
            eyebrow: '',
            title: 'What would you like to build?',
            description: 'Describe it in your own words. Your colleague will take it from there.',
          }}
          composerPlaceholder="Tell me what you need…"
          composerActivity={stage.activity || thinkingStartedAt !== null
            ? <ActivityStrip builder={stage.activity} thinkingStartedAt={thinkingStartedAt} />
            : null}
          onPromptSubmitStarted={beginThinking}
          onData={onAgentData}
          onTurnComplete={() => {
            setThinkingStartedAt(null)
            if (activityRef.current?.milestone === 'done') stage.clearActivity()
          }}
          className="h-full"
        />
      ) : null}
    </div>
  )

  return (
    <div
      className="one-chat-shell"
      data-testid="one-chat-shell"
      data-resizing={chat.resizing ? '' : undefined}
      data-mobile={mobile ? '' : undefined}
      data-screen-visible={stage.screen ? '' : undefined}
      data-chat-mode={mobile ? stage.mobileChat.mode : undefined}
      style={{
        ['--one-chat-chat-width' as string]: `${chat.width}px`,
        ...(mobile
          ? {
              ['--one-chat-viewport-height' as string]: `${viewport.height}px`,
              ['--one-chat-viewport-top' as string]: `${viewport.offsetTop}px`,
            }
          : {}),
      }}
    >
      {mobile ? (
        stage.screen ? (
          <>
            <Stage screen={stage.screen} onReady={stage.markAppReady} />
            <div
              className="one-chat-mobile-sheet"
              data-testid="one-chat-mobile-sheet"
              aria-hidden={stage.mobileChat.mode === 'button' ? 'true' : undefined}
              inert={stage.mobileChat.mode === 'button' ? true : undefined}
            >
              <Resizer
                orientation="horizontal"
                mobileMode={stage.mobileChat.mode === 'full' ? 'full' : 'half'}
                onExpand={stage.expandChat}
                onHide={stage.hideChat}
                onResizingChange={chat.setResizing}
              />
              {chatSurface}
            </div>
            <button type="button" className="one-chat-launcher" aria-label="Open chat" data-testid="one-chat-launcher" onClick={stage.openChat}>
              <ColleagueIcon />
              {stage.mobileChat.unseenAssistant ? <span className="one-chat-launcher-dot" data-testid="one-chat-unseen" /> : null}
            </button>
          </>
        ) : chatSurface
      ) : (
        <>
          {chatSurface}
          {stage.screen ? (
            <>
              <Resizer
                size={chat.size}
                orientation="vertical"
                onChange={chat.apply}
                onReset={chat.reset}
                onResizingChange={chat.setResizing}
              />
              <Stage screen={stage.screen} />
            </>
          ) : null}
        </>
      )}
    </div>
  )
}

function ColleagueIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2c.45 4.85 2.95 7.35 7.8 7.8-4.85.45-7.35 2.95-7.8 7.8-.45-4.85-2.95-7.35-7.8-7.8 4.85-.45 7.35-2.95 7.8-7.8Z" />
      <path d="M18.2 2.7c.13 1.45.88 2.2 2.33 2.33-1.45.13-2.2.88-2.33 2.33-.13-1.45-.88-2.2-2.33-2.33 1.45-.13 2.2-.88 2.33-2.33Z" />
    </svg>
  )
}

export default App
