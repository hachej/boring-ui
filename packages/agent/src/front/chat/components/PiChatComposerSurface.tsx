"use client"

import type { CSSProperties, ChangeEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { LoaderCircleIcon, MicIcon, SquareIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { QueuedUserMessage } from '../../../shared/chat'
import type { AvailableModel, ModelSelection, ThinkingLevel } from '../../chatPanelSettings'
import type { PluginUpdateState } from '../../composer/PluginUpdateStatus'
import { PluginUpdateStatus } from '../../composer/PluginUpdateStatus'
import type { CommandRunState } from '../../composer/CommandRunStatus'
import { CommandRunStatus } from '../../composer/CommandRunStatus'
import {
  ModelPickerMenu,
  ModelSelectTrigger,
  ThinkingPickerMenu,
  ThinkingSelectTrigger,
} from '../../chatPanelComposerControls'
import { cn } from '../../lib'
import { useComposerRecordingAdapter, type ComposerRecordingSnapshot } from '../composerRecording'
import type { MentionState } from '../../primitives/mention-picker'
import { MentionPicker } from '../../primitives/mention-picker'
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputFilePart,
} from '../../primitives/prompt-input'
import { SlashCommandPicker } from '../../primitives/slash-command-picker'
import type { SlashCommand } from '../../slashCommands'
import { uploadFile } from '../../upload/uploadFile'
import { AttachmentButton, AttachmentsList } from './ComposerAttachments'
import {
  ComposerBlockerNotice,
  ComposerRuntimeNotice,
  QueuedComposerNotice,
  type ComposerBlocker,
} from './ChatNotices'
import { noticeSurfaceClass } from './noticeStyles'

const MAX_PROMPT_ATTACHMENTS = 2
const MAX_PROMPT_ATTACHMENT_BYTES = 4 * 1024 * 1024
const COMPOSER_INPUT_GROUP_MIN_HEIGHT = 56
const COMPOSER_TEXTAREA_MAX_HEIGHT = 160
const COMPOSER_MULTILINE_EXTRA_HEIGHT = 8
const COMPOSER_TEXTAREA_VERTICAL_INSET = 16
const IDLE_RECORDING: ComposerRecordingSnapshot = { phase: 'idle' }
const noopSubscribe = () => () => {}

function hasSoftWrappedLine(node: HTMLTextAreaElement, style: CSSStyleDeclaration): boolean {
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
  const paddingRight = Number.parseFloat(style.paddingRight) || 0
  const contentWidth = node.clientWidth - paddingLeft - paddingRight
  if (contentWidth <= 0) return false

  const context = document.createElement('canvas').getContext('2d')
  if (!context) return false
  context.font = style.font
  const letterSpacing = Number.parseFloat(style.letterSpacing) || 0

  return node.value.split('\n').some((line) => {
    const measuredWidth = context.measureText(line || ' ').width
    const spacedWidth = measuredWidth + Math.max(0, line.length - 1) * letterSpacing
    return spacedWidth > contentWidth + 1
  })
}

export interface PiChatComposerSurfaceProps<
  TComposerBlocker extends ComposerBlocker = ComposerBlocker,
> {
  chrome: boolean
  isStreaming: boolean
  status: string
  disabled: boolean
  submitStatus: 'ready' | 'submitted' | 'streaming' | 'error'
  submitDisabled: boolean
  composerBlocked: boolean
  composerBlockerLabel: string
  composerPlaceholder?: string
  composerStatusNotice: { title: string; detail?: string; code?: string } | null
  workspaceWarmupBlocked: boolean
  primaryComposerBlocker?: TComposerBlocker
  onComposerBlockerAction?: (blocker: TComposerBlocker, action: string) => void
  queuePreview: QueuedUserMessage[]
  onEditQueued: () => void
  hotReloadEnabled: boolean
  pluginUpdateState: PluginUpdateState | null
  onDismissPluginUpdate: () => void
  onRunPluginUpdate: () => Promise<string>
  commandNotifyState: CommandRunState | null
  onDismissCommandNotify: () => void
  attachmentNotice?: string | null
  onAttachmentNotice: (message: string) => void
  mentionState: MentionState | null
  slashQuery: string | null
  apiBaseUrl?: string
  fetch?: typeof globalThis.fetch
  requestHeaders?: Record<string, string> | undefined
  storageScope: string
  onSelectMention: (path: string) => void
  onDismissMention: () => void
  commands: SlashCommand[]
  onSelectSlashCommand: (name: string) => void
  onDismissSlash: () => void
  modelPickerOpen: boolean
  selectedModel: ModelSelection | null
  modelOptions: AvailableModel[]
  modelControlled: boolean
  hideDefaultModelOption?: boolean
  hideComposerSettings?: boolean
  onModelChange: (model: ModelSelection | null) => void
  onSetModelPickerOpen: (open: boolean) => void
  onOpenModelPicker: () => boolean
  thinkingPickerOpen: boolean
  selectedThinking: ThinkingLevel
  thinkingControl: boolean
  thinkingControlled: boolean
  onThinkingChange: (level: ThinkingLevel) => void
  onSetThinkingPickerOpen: (open: boolean) => void
  onOpenThinkingPicker: () => boolean
  draft: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onTextareaChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onInsertTranscript?: (text: string) => void
  onSubmitMessage: (payload: { text: string; files: PromptInputFilePart[] }) => false | void | Promise<false | void>
  onStop: () => void
}

export function PiChatComposerSurface<
  TComposerBlocker extends ComposerBlocker = ComposerBlocker,
>({
  chrome,
  isStreaming,
  status,
  disabled,
  submitStatus,
  submitDisabled,
  composerBlocked,
  composerBlockerLabel,
  composerPlaceholder,
  composerStatusNotice,
  workspaceWarmupBlocked,
  primaryComposerBlocker,
  onComposerBlockerAction,
  queuePreview,
  onEditQueued,
  hotReloadEnabled,
  pluginUpdateState,
  onDismissPluginUpdate,
  onRunPluginUpdate,
  commandNotifyState,
  onDismissCommandNotify,
  attachmentNotice,
  onAttachmentNotice,
  mentionState,
  slashQuery,
  apiBaseUrl,
  fetch,
  requestHeaders,
  storageScope,
  onSelectMention,
  onDismissMention,
  commands,
  onSelectSlashCommand,
  onDismissSlash,
  modelPickerOpen,
  selectedModel,
  modelOptions,
  modelControlled,
  hideDefaultModelOption = false,
  hideComposerSettings = false,
  onModelChange,
  onSetModelPickerOpen,
  onOpenModelPicker,
  thinkingPickerOpen,
  selectedThinking,
  thinkingControl,
  thinkingControlled,
  onThinkingChange,
  onSetThinkingPickerOpen,
  onOpenThinkingPicker,
  draft,
  textareaRef,
  onTextareaChange,
  onTextareaKeyDown,
  onInsertTranscript,
  onSubmitMessage,
  onStop,
}: PiChatComposerSurfaceProps<TComposerBlocker>) {
  const workspaceRequestId = getHeaderValue(requestHeaders, 'x-boring-workspace-id')
  const recordingAdapter = useComposerRecordingAdapter()
  const recording = useSyncExternalStore(
    recordingAdapter?.subscribe ?? noopSubscribe,
    recordingAdapter?.getSnapshot ?? (() => IDLE_RECORDING),
    () => IDLE_RECORDING,
  )
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  useEffect(() => {
    const update = () => setElapsedSeconds(recording.startedAt ? Math.max(0, Math.floor((Date.now() - recording.startedAt) / 1_000)) : 0)
    update()
    if (!recording.startedAt || recording.phase === 'idle' || recording.phase === 'error') return
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [recording.phase, recording.startedAt])
  const toggleRecording = useCallback(async () => {
    if (!recordingAdapter || recording.phase === 'transcribing') return
    if (recording.kind === 'short' && recording.phase === 'starting') return
    if (recording.kind === 'short' && recording.phase === 'recording') {
      const text = await recordingAdapter.stopShort()
      if (text) onInsertTranscript?.(text)
      return
    }
    if (recording.kind === 'live' && (recording.phase === 'recording' || recording.phase === 'starting')) {
      await recordingAdapter.stopLive()
      return
    }
    await recordingAdapter.startShort()
  }, [onInsertTranscript, recording.kind, recording.phase, recordingAdapter])
  const uploadAttachment = useCallback((file: File) => uploadFile(file, {
    apiBaseUrl,
    workspaceRequestId,
    responseUrl: 'raw',
    fetch,
  }), [apiBaseUrl, fetch, workspaceRequestId])

  const resizeTextarea = useCallback((node: HTMLTextAreaElement | null) => {
    if (!node) return
    node.style.height = 'auto'
    const style = window.getComputedStyle(node)
    const lineHeight = Number.parseFloat(style.lineHeight) || 24
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
    const singleLineHeight = lineHeight + paddingTop + paddingBottom
    const hasExplicitLineBreak = node.value.includes('\n')
    const hasWrappedLine = node.value.length > 0 && hasSoftWrappedLine(node, style)
    const isMultiline = hasExplicitLineBreak || hasWrappedLine
    const extraHeight = isMultiline ? COMPOSER_MULTILINE_EXTRA_HEIGHT : 0
    const contentHeight = isMultiline ? node.scrollHeight + extraHeight : singleLineHeight
    const nextHeight = Math.min(contentHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)
    node.style.height = `${nextHeight}px`
    node.style.overflowY = contentHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
    const rail = node.closest('[data-boring-agent-part="composer-rail"]') as HTMLElement | null
    const inputGroupHeight = isMultiline
      ? Math.max(COMPOSER_INPUT_GROUP_MIN_HEIGHT, nextHeight + COMPOSER_TEXTAREA_VERTICAL_INSET)
      : COMPOSER_INPUT_GROUP_MIN_HEIGHT
    rail?.style.setProperty('--composer-input-group-height', `${inputGroupHeight}px`)
    rail?.setAttribute('data-composer-multiline', inputGroupHeight > COMPOSER_INPUT_GROUP_MIN_HEIGHT ? 'true' : 'false')
  }, [])

  useLayoutEffect(() => {
    resizeTextarea(textareaRef.current)
  }, [draft, resizeTextarea, textareaRef])

  return (
    <div className={cn('relative z-20', chrome ? 'px-4 pb-4 pt-2 sm:px-6 sm:pb-5' : 'px-3 pb-2 pt-1')}>
      <div
        data-boring-agent-part="chat-working-slot"
        className={cn(
          'mx-auto w-full overflow-hidden transition-[margin,max-height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          chrome ? 'max-w-3xl' : 'max-w-[680px]',
          isStreaming ? 'mb-2 max-h-8 opacity-100' : 'mb-0 max-h-0 opacity-0',
        )}
        aria-hidden={!isStreaming}
      >
        <div
          data-testid={isStreaming ? 'chat-working' : undefined}
          role={isStreaming ? 'status' : undefined}
          aria-live={isStreaming ? 'polite' : undefined}
          className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/85 px-2.5 py-1 text-[12px] text-muted-foreground/75 shadow-sm backdrop-blur"
        >
          <motion.span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full bg-[color:var(--accent)]"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <span>Working…</span>
        </div>
      </div>
      {composerStatusNotice ? <ComposerRuntimeNotice notice={composerStatusNotice} /> : null}
      {composerBlocked && !workspaceWarmupBlocked ? (
        <ComposerBlockerNotice
          blocker={primaryComposerBlocker}
          label={composerBlockerLabel}
          onAction={onComposerBlockerAction}
        />
      ) : null}
      {queuePreview.length > 0 ? (
        <QueuedComposerNotice followUps={queuePreview} onEdit={onEditQueued} />
      ) : null}
      {hotReloadEnabled ? (
        <PluginUpdateStatus
          state={pluginUpdateState}
          onDismiss={onDismissPluginUpdate}
          onRetry={onRunPluginUpdate}
        />
      ) : null}
      <CommandRunStatus
        state={commandNotifyState}
        onDismiss={onDismissCommandNotify}
      />
      {attachmentNotice ? (
        <div
          role="status"
          aria-live="polite"
          className={noticeSurfaceClass('info', 'mx-auto mb-2 w-full max-w-3xl text-xs')}
        >
          {attachmentNotice}
        </div>
      ) : null}
      <div className={cn('mx-auto w-full', chrome ? 'max-w-3xl' : 'max-w-[680px]')}>
        {mentionState ? (
          <MentionPicker
            mention={mentionState}
            apiBaseUrl={apiBaseUrl}
            fetch={fetch}
            requestHeaders={requestHeaders}
            storageScope={storageScope}
            onSelect={onSelectMention}
            onDismiss={onDismissMention}
          />
        ) : null}
        {slashQuery !== null ? (
          <SlashCommandPicker
            query={slashQuery}
            commands={commands}
            onSelect={onSelectSlashCommand}
            onDismiss={onDismissSlash}
          />
        ) : null}
        {mentionState === null && slashQuery === null && modelPickerOpen ? (
          <ModelPickerMenu
            value={selectedModel}
            onChange={onModelChange}
            options={modelOptions}
            disabled={isStreaming || modelControlled}
            hideDefaultOption={hideDefaultModelOption}
            onClose={() => onSetModelPickerOpen(false)}
          />
        ) : null}
        {mentionState === null && slashQuery === null && thinkingPickerOpen ? (
          <ThinkingPickerMenu
            value={selectedThinking}
            onChange={onThinkingChange}
            disabled={isStreaming || thinkingControlled}
            onClose={() => onSetThinkingPickerOpen(false)}
          />
        ) : null}
      </div>
      {recording.phase === 'error' && recording.error ? (
        <div
          role="alert"
          data-boring-agent-part="composer-recording-error"
          className={cn(
            'mx-auto mb-2 w-full rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive',
            chrome ? 'max-w-3xl' : 'max-w-[680px]',
          )}
        >
          {recording.error}
        </div>
      ) : null}
      <div
        data-boring-agent-part="composer-rail"
        data-composer-multiline="false"
        style={{ '--composer-input-group-height': `${COMPOSER_INPUT_GROUP_MIN_HEIGHT}px` } as CSSProperties}
        className={cn(
          'relative mx-auto w-full overflow-visible rounded-[28px]',
          chrome ? 'max-w-3xl bg-transparent shadow-[0_1px_2px_-1px_oklch(0_0_0/0.06),0_6px_18px_-12px_oklch(0_0_0/0.12),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[0_1px_3px_-1px_oklch(0_0_0/0.08),0_10px_28px_-14px_oklch(0_0_0/0.16),inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)]' : 'max-w-[680px] bg-transparent shadow-[inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)]',
          'transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          '[&_[data-slot=input-group]]:!h-auto [&_[data-slot=input-group]]:!min-h-[var(--composer-input-group-height)]',
          '[&_[data-slot=input-group]]:!flex-col [&_[data-slot=input-group]]:!items-stretch [&_[data-slot=input-group]]:!overflow-hidden',
          '[&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!rounded-[28px]',
          '[&_[data-slot=input-group]]:!bg-transparent [&_[data-slot=input-group]]:!shadow-none',
          '[&_[data-slot=input-group]]:dark:!bg-transparent [&_[data-slot=input-group]]:!ring-0',
          '[&_[data-slot=input-group]]:has-[:focus]:!ring-0',
          '[&[data-composer-multiline=true]_[data-boring-agent-part=composer-submit-addon]]:self-end',
          '[&[data-composer-multiline=true]_[data-boring-agent-part=composer-submit-addon]]:mb-2',
        )}
      >
        <PromptInput
          data-boring-state={status}
          onSubmit={(message) => onSubmitMessage({ text: message.text, files: message.files })}
          onUploadFile={uploadAttachment}
          multiple
          maxFiles={disabled || isStreaming ? 0 : MAX_PROMPT_ATTACHMENTS}
          maxFileSize={MAX_PROMPT_ATTACHMENT_BYTES}
          onError={(err) => {
            if (err.code === 'max_files') onAttachmentNotice(`Up to ${MAX_PROMPT_ATTACHMENTS} attachments per message.`)
            else if (err.code === 'max_file_size') onAttachmentNotice('Files must be under 4 MB each.')
            else if (err.code === 'accept') onAttachmentNotice("That file type isn't supported here.")
            else onAttachmentNotice(err.message || 'Attachment rejected.')
          }}
        >
          <AttachmentsList />
          <div
            data-boring-agent-part="composer-input-row"
            className="flex min-h-[var(--composer-input-group-height)] w-full items-center"
          >
            <div className="flex h-14 shrink-0 items-center pl-2">
              <AttachmentButton disabled={disabled || isStreaming} />
            </div>
            <PromptInputTextarea
              value={draft}
              placeholder={
                composerBlocked
                  // Warmup has no action bar, so the label belongs in the
                  // placeholder. A real blocker already shows the label in the
                  // ComposerBlockerNotice bar above — don't repeat it here.
                  ? (workspaceWarmupBlocked ? composerBlockerLabel : '')
                  : composerPlaceholder ?? 'Ask anything…'
              }
              disabled={disabled}
              readOnly={composerBlocked}
              aria-label="Agent prompt"
              ref={(node) => {
                textareaRef.current = node
                resizeTextarea(node)
              }}
              onChange={onTextareaChange}
              onKeyDown={onTextareaKeyDown}
              style={{ fieldSizing: 'fixed' } as CSSProperties}
              className={cn(
                'min-w-0 flex-1 !min-h-10 !max-h-40 resize-none overflow-hidden border-0 bg-transparent shadow-none',
                '[field-sizing:fixed]',
                'px-2 py-2 text-[13px] leading-6',
                'placeholder:text-muted-foreground/45',
                'focus-visible:ring-0 focus-visible:ring-offset-0',
              )}
            />
            <PromptInputFooter
              align="inline-end"
              data-boring-agent-part="composer-submit-addon"
              className="!order-none !w-auto shrink-0 self-center justify-between border-0 bg-transparent !px-2 !py-0"
            >
              <div className="ml-auto flex items-center gap-1.5">
                {recordingAdapter ? (
                  <button
                    type="button"
                    data-boring-agent-part="composer-recording-control"
                    aria-label={recording.phase === 'recording' || recording.phase === 'starting' ? `Stop ${recording.kind ?? ''} recording` : 'Start short dictation'}
                    title={recording.error ?? (recording.phase === 'idle' ? 'Start short dictation' : `${recording.kind === 'live' ? 'Live recording' : 'Short dictation'} ${formatElapsed(elapsedSeconds)}`)}
                    onClick={() => { void toggleRecording() }}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium transition-colors',
                      recording.phase === 'recording' || recording.phase === 'starting'
                        ? 'bg-red-500/12 text-red-600 hover:bg-red-500/20 dark:text-red-400'
                        : recording.phase === 'error'
                          ? 'bg-destructive/10 text-destructive hover:bg-destructive/15'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {recording.phase === 'starting' || recording.phase === 'transcribing' ? (
                      <LoaderCircleIcon className="size-3.5 animate-spin" />
                    ) : recording.phase === 'recording' ? (
                      <><span className="size-2 rounded-full bg-red-500 animate-pulse" /><SquareIcon className="size-3" /></>
                    ) : (
                      <MicIcon className="size-3.5" />
                    )}
                    {recording.phase !== 'idle' ? (
                      <span>{recording.kind === 'live' ? 'Live' : recording.phase === 'transcribing' ? 'Transcribing' : 'Short'} {formatElapsed(elapsedSeconds)}</span>
                    ) : null}
                  </button>
                ) : null}
                <PromptInputSubmit
                  data-boring-agent-part="composer-submit"
                  status={submitStatus}
                  onStop={onStop}
                  disabled={submitDisabled}
                  className={cn(
                    'h-8 w-8 shrink-0 rounded-full',
                    'bg-foreground',
                    'text-background',
                    'transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]',
                    'hover:bg-foreground/90 hover:shadow-[0_0_0_3px_oklch(from_var(--foreground)_l_c_h/0.12)] hover:scale-[1.04]',
                    'active:scale-[0.93] active:brightness-95',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
                    'disabled:pointer-events-none disabled:opacity-40',
                    '[&>svg]:size-3.5',
                  )}
                />
              </div>
            </PromptInputFooter>
          </div>
        </PromptInput>
      </div>
      {hideComposerSettings ? null : (
      <div
        data-boring-agent-part="composer-settings-row"
        className={cn(
          'mx-auto mt-1.5 flex w-full items-center justify-center gap-1.5 text-[10.5px] text-muted-foreground/45',
          chrome ? 'max-w-3xl' : 'max-w-[680px]',
        )}
      >
        <ModelSelectTrigger
          value={selectedModel}
          options={modelOptions}
          disabled={isStreaming || modelControlled}
          trigger="slash"
          open={modelPickerOpen}
          onClick={() => {
            if (modelPickerOpen) {
              onSetModelPickerOpen(false)
              return
            }
            void onOpenModelPicker()
          }}
        />
        {thinkingControl ? (
          <ThinkingSelectTrigger
            value={selectedThinking}
            disabled={isStreaming || thinkingControlled}
            trigger="slash"
            open={thinkingPickerOpen}
            onClick={() => {
              if (thinkingPickerOpen) {
                onSetThinkingPickerOpen(false)
                return
              }
              void onOpenThinkingPicker()
            }}
          />
        ) : null}
      </div>
      )}
    </div>
  )
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function getHeaderValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  return headers[name] ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

