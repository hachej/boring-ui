import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import { MicIcon } from "lucide-react"
import {
  ChatMessageContributionProvider,
  ComposerContributionProvider,
  type BoringChatMessage,
  type ComposerActionContributionProps,
  type ComposerContribution,
  type ChatMessageContribution,
  type ChatMessageContributionProps,
} from "@hachej/boring-agent/front"
import { MarkdownEditorPane, postUiCommand, type MarkdownEditorPaneProps } from "@hachej/boring-workspace"
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { liveTranscriptCommands, liveTranscriptController, LiveTranscriptBrowserController } from "./controller"
import { downmixAndResample } from "./pcm"
import { liveTranscriptBrowserState } from "./state"
import { TranscriptReviewToolMessage, transcriptReviewPresentationFromMessage } from "./TranscriptReviewToolMessage"

const LIVE_MARKDOWN_PANEL_ID = "live-transcription.markdown"


export function LiveTranscriptComposerTop() {
  const recording = useSyncExternalStore(
    liveTranscriptBrowserState.subscribe,
    liveTranscriptBrowserState.getSnapshot,
    liveTranscriptBrowserState.getSnapshot,
  )
  if (recording.phase === "error" && recording.error) {
    return (
      <div
        role="alert"
        data-boring-agent-part="live-transcription-error"
        className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive"
      >
        {recording.error}
      </div>
    )
  }
  if (recording.recordingKind !== "live" || !isActiveRecordingPhase(recording.phase)) return null
  return <LiveTranscriptComposerDock />
}

export function LiveTranscriptComposerAction({
  updateDraft,
  streaming = false,
}: ComposerActionContributionProps & { streaming?: boolean }) {
  const recording = useSyncExternalStore(
    liveTranscriptBrowserState.subscribe,
    liveTranscriptBrowserState.getSnapshot,
    liveTranscriptBrowserState.getSnapshot,
  )
  const elapsedSeconds = useElapsedSeconds(recording.startedAt, recording.phase)
  if (recording.recordingKind === "live" && isActiveRecordingPhase(recording.phase)) return null

  const recordingThisMode = recording.phase === "recording" && recording.recordingKind === (streaming ? "composer" : "short")
  const otherModeRecording = recording.phase === "recording" && !recordingThisMode
  const disabled = recording.phase === "transcribing" || recording.phase === "starting" || otherModeRecording
  const label = disabled
    ? streaming ? "Starting streaming dictation" : "Transcribing short dictation"
    : recordingThisMode
      ? streaming ? "Stop streaming dictation" : "Stop short recording"
      : streaming ? "Start streaming dictation" : "Start short dictation"
  const appendWord = (word: string) => updateDraft((current) => appendTranscriptToDraft(current, word), { focus: false })
  const toggle = async () => {
    if (disabled) return
    if (streaming) {
      if (recordingThisMode) await liveTranscriptController.stopComposer()
      else await liveTranscriptController.startComposer(appendWord)
      return
    }
    if (recordingThisMode) {
      const text = await liveTranscriptController.stopShort()
      if (text) updateDraft((current) => appendTranscriptToDraft(current, text))
      return
    }
    await liveTranscriptController.startShort()
  }

  return (
    <button
      type="button"
      data-boring-agent-part="live-transcription-control"
      aria-label={label}
      title={recording.error ?? `${label}${recording.phase === "idle" ? "" : ` ${formatClock(elapsedSeconds)}`}`}
      disabled={disabled}
      onClick={() => { void toggle().catch(() => undefined) }}
      className={`flex h-8 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-65 ${
        recordingThisMode || recording.phase === "starting"
          ? "bg-red-500/12 text-red-600 hover:bg-red-500/20 dark:text-red-400"
          : recording.phase === "error"
            ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {recording.phase === "starting" || recording.phase === "transcribing" ? (
        <LoadingIcon />
      ) : recordingThisMode ? (
        <StopIcon />
      ) : (
        <MicIcon aria-hidden="true" className="size-4" strokeWidth={1.8} />
      )}
      {recording.phase === "starting" || recording.phase === "transcribing" ? (
        <span>{recording.phase === "transcribing" ? "Transcribing" : "Starting"} {formatClock(elapsedSeconds)}</span>
      ) : recordingThisMode ? (
        <span aria-live="off" className="min-w-[3ch] tabular-nums">{formatClock(elapsedSeconds)}</span>
      ) : null}
    </button>
  )
}

export function LiveTranscriptComposerDock() {
  const recording = useSyncExternalStore(
    liveTranscriptBrowserState.subscribe,
    liveTranscriptBrowserState.getSnapshot,
    liveTranscriptBrowserState.getSnapshot,
  )
  const [now, setNow] = useState(() => Date.now())
  const [reviewing, setReviewing] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const elapsedSeconds = Math.max(0, Math.floor((now - (recording.startedAt ?? now)) / 1_000))
  const reviewIntervalSeconds = Math.max(1, Math.ceil((recording.reviewIntervalMs ?? 60_000) / 1_000))
  const nudgeRemainingSeconds = reviewIntervalSeconds - (elapsedSeconds % reviewIntervalSeconds)
  const progress = ((reviewIntervalSeconds - nudgeRemainingSeconds) / reviewIntervalSeconds) * 100

  const pingAgent = async () => {
    if (reviewing) return
    setReviewing(true)
    setNotice(undefined)
    try {
      const result = await liveTranscriptController.review()
      setNotice(
        result.startsWith("Transcript review dispatched")
          ? "Review sent"
          : result.startsWith("Transcript review queued")
            ? "Review queued"
            : "Agent unavailable",
      )
    } finally {
      setReviewing(false)
    }
  }

  const stop = async () => {
    if (stopping) return
    setStopping(true)
    setNotice("Finalizing transcript…")
    try {
      await liveTranscriptController.stopLiveRecording()
    } finally {
      setStopping(false)
    }
  }

  return (
    <div
      data-boring-agent-part="live-transcript-dock"
      className="w-full"
    >
      <div className="overflow-hidden rounded-[18px] border border-border/70 bg-card/95 shadow-[0_10px_32px_-24px_oklch(0_0_0/0.55)]">
        <div className="flex flex-nowrap items-center gap-2 px-3 py-2.5">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-2.5 shrink-0 items-center justify-center rounded-full bg-red-500/18" aria-hidden="true">
              <span className="size-1.5 rounded-full bg-red-500" />
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span aria-label="Live transcription" className="text-[12px] font-semibold text-foreground">Live</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatClock(elapsedSeconds)}</span>
              </div>
              <div className="sr-only">
                {recording.phase === "starting" ? "Connecting microphone" : "Local-only microphone active"}
              </div>
            </div>
          </div>

          <div className="flex min-w-20 flex-1 flex-col gap-1">
            <div className="text-[11px] font-medium text-foreground/80">
              Next check ~{formatCompact(nudgeRemainingSeconds)}
            </div>
            <div
              role="progressbar"
              aria-label="Time until next check"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-valuetext={`Next check in approximately ${formatCompact(nudgeRemainingSeconds)}`}
              className="h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-foreground/65 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: `translateX(${progress - 100}%)` }}
              />
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                if (!recording.transcriptPath) return
                postUiCommand({
                  kind: "openSurface",
                  params: { kind: "workspace.open.path", target: recording.transcriptPath },
                })
              }}
              disabled={!recording.transcriptPath}
              aria-label="Open transcript"
              title="Open transcript"
              className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-45"
            >
              <DocumentIcon />
              Transcript
            </button>
            <button
              type="button"
              onClick={() => { void pingAgent() }}
              disabled={reviewing || stopping || recording.phase === "starting"}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-45"
            >
              <SparkIcon />
              {reviewing
                ? "Wait…"
                : notice === "Review sent"
                  ? "Sent"
                  : notice === "Review queued"
                    ? "Queued"
                    : notice === "Agent unavailable"
                      ? "Retry"
                      : "Review"}
            </button>
            <button
              type="button"
              onClick={() => { void stop() }}
              disabled={stopping}
              aria-label={stopping ? "Finalizing transcript" : "Stop transcription"}
              title={stopping ? "Finalizing transcript" : "Stop transcription"}
              className="inline-flex size-8 items-center justify-center rounded-full bg-red-500/12 text-red-600 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 disabled:opacity-60 dark:text-red-400"
            >
              <span className="size-2 rounded-[2px] bg-current" aria-hidden="true" />
            </button>
          </div>
        </div>

        {notice && notice !== "Finalizing transcript…" ? (
          <div role="status" aria-live="polite" className="sr-only">{notice}</div>
        ) : null}

      </div>
    </div>
  )
}

function useElapsedSeconds(startedAt?: number, phase?: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!startedAt || phase === "idle" || phase === "error") return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [phase, startedAt])
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1_000)) : 0
}

function isActiveRecordingPhase(phase?: string): boolean {
  return phase === "starting" || phase === "recording" || phase === "transcribing"
}

export function appendTranscriptToDraft(draft: string, transcript: string): string {
  const separator = draft.length > 0 && !/\s$/u.test(draft) ? " " : ""
  return `${draft}${separator}${transcript}`
}

function LoadingIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 animate-spin fill-none stroke-current" strokeWidth="1.5"><path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" /></svg>
}

function StopIcon() {
  return (
    <span
      aria-hidden="true"
      data-boring-agent-part="recording-stop-icon"
      className="flex size-4 items-center justify-center"
    >
      <span className="size-2.5 rounded-[2px] bg-current" />
    </span>
  )
}

function DocumentIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current" strokeWidth="1.4" strokeLinejoin="round"><path d="M4 1.75h5l3 3V14.25H4z"/><path d="M9 1.75v3h3"/></svg>
}

function SparkIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current" strokeWidth="1.4"><path d="M8 1.5c.35 2.9 1.6 4.15 4.5 4.5C9.6 6.35 8.35 7.6 8 10.5 7.65 7.6 6.4 6.35 3.5 6 6.4 5.65 7.65 4.4 8 1.5Z"/><path d="M12.5 10c.17 1.4.77 2 2 2.2-1.23.2-1.83.8-2 2.3-.17-1.5-.77-2.1-2-2.3 1.23-.2 1.83-.8 2-2.2Z"/></svg>
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function formatCompact(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

function TranscriptReviewMessageContribution({ message }: ChatMessageContributionProps) {
  const presentation = transcriptReviewPresentationFromMessage(message)
  return presentation
    ? <TranscriptReviewToolMessage message={message} presentation={presentation} />
    : null
}

function createLiveTranscriptComposerContribution(streaming: boolean): ComposerContribution {
  return {
    id: "live-transcription",
    Top: LiveTranscriptComposerTop,
    Action: (props) => <LiveTranscriptComposerAction {...props} streaming={streaming} />,
    commands: liveTranscriptCommands,
  }
}

const disabledLiveTranscriptComposerContribution: ComposerContribution = {
  id: "live-transcription",
}

const liveTranscriptMessageContribution: ChatMessageContribution = {
  id: "live-transcription.review",
  matches: (message: BoringChatMessage) => transcriptReviewPresentationFromMessage(message) !== undefined,
  Component: TranscriptReviewMessageContribution,
}

function LiveTranscriptComposerProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState({ ready: false, streamingComposer: false })
  useEffect(() => {
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (response) => response.ok ? await response.json() as { liveTranscripts?: { ready?: boolean; streamingComposer?: boolean; pcmSampleRate?: number } } : undefined)
      .then((meta) => {
        if (!cancelled) {
          liveTranscriptController.setStreamingSampleRate(meta?.liveTranscripts?.pcmSampleRate ?? 16_000)
          setCapabilities({
            ready: meta?.liveTranscripts?.ready === true,
            streamingComposer: meta?.liveTranscripts?.streamingComposer === true,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ ready: false, streamingComposer: false })
      })
    return () => { cancelled = true }
  }, [])
  const composerContribution = useMemo(
    () => capabilities.ready
      ? createLiveTranscriptComposerContribution(capabilities.streamingComposer)
      : disabledLiveTranscriptComposerContribution,
    [capabilities],
  )
  return (
    <ChatMessageContributionProvider contribution={liveTranscriptMessageContribution}>
      <ComposerContributionProvider contribution={composerContribution}>
        {children}
      </ComposerContributionProvider>
    </ChatMessageContributionProvider>
  )
}

function LiveTranscriptLifecycleBinding() {
  useEffect(() => liveTranscriptController.mount(), [])
  return null
}

export function LiveTranscriptMarkdownPane(props: MarkdownEditorPaneProps) {
  const active = useSyncExternalStore(
    liveTranscriptBrowserState.subscribe,
    liveTranscriptBrowserState.getSnapshot,
    liveTranscriptBrowserState.getSnapshot,
  )
  const path = typeof props.params?.path === "string" ? props.params.path : ""
  const locked = Boolean(path && active.transcriptPath === path && active.state !== "complete" && active.state !== "interrupted")
  return (
    <MarkdownEditorPane
      {...props}
      params={{ ...props.params, mode: locked ? "view" : "edit" }}
    />
  )
}

export const liveTranscriptPlugin = definePlugin({
  id: "live-transcription",
  label: "Live transcription",
  providers: [{ id: "live-transcription.composer-recording", component: LiveTranscriptComposerProvider }],
  panels: [{
    id: LIVE_MARKDOWN_PANEL_ID,
    label: "Live transcript",
    component: LiveTranscriptMarkdownPane as ComponentType<any>,
    placement: "center",
    source: "app",
  }],
  surfaceResolvers: [{
    id: "live-transcription.active-markdown",
    kind: "workspace.open.path",
    source: "app",
    resolve(request) {
      const active = liveTranscriptBrowserState.getSnapshot()
      if (!active.transcriptPath || request.target !== active.transcriptPath) return undefined
      return {
        id: `file:${request.target}`,
        component: LIVE_MARKDOWN_PANEL_ID,
        title: request.target.split("/").pop() ?? request.target,
        params: { path: request.target },
        score: 10_000,
      }
    },
  }],
  bindings: [{ id: "live-transcription.lifecycle", component: LiveTranscriptLifecycleBinding }],
})

export {
  downmixAndResample,
  liveTranscriptBrowserState,
  liveTranscriptCommands,
  liveTranscriptController,
  LiveTranscriptBrowserController,
}
