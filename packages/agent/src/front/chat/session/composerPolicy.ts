import type { BoringChatMessage, ChatAttachmentPayload, PromptPayload } from '../../../shared/chat'
import type { PromptInputFilePart } from '../../primitives/prompt-input-context'
import type { AvailableModel, ModelSelection, ThinkingLevel } from '../../chatPanelSettings'
import { DEFAULT_THINKING, isThinkingLevel, parseModelSelection } from '../../chatPanelSettings'
import { createEnrichedSubmitPayload } from '../../chatSubmit'
import { parseSlashCommand } from '../../slashCommands/parser'
import type { CommandRegistry, SlashCommandContext } from '../../slashCommands/registry'
import {
  createPiFollowUpQueueController,
  isPiChatBusy,
  type PiQueueControllerOptions,
  type PiQueueSessionLike,
  type PiQueueSubmitResult,
} from '../pi/piFollowUpQueueController'
import type { ActiveSessionStorageLike } from './activeSessionStorage'

const COMPOSER_SETTINGS_PREFIX = 'boring-agent:v2'
const DEFAULT_STORAGE_SCOPE = 'default'

export interface PiComposerSettingsStorageOptions {
  storageScope?: string
  storage?: ActiveSessionStorageLike
}

export interface PiComposerSettings {
  model: ModelSelection | null
  userSelectedModel: boolean
  thinkingLevel: ThinkingLevel
  showThoughts: boolean
}

export interface PiComposerSubmitInput {
  text: string
  files?: PromptInputFilePart[]
  source?: 'composer' | 'suggestion' | 'auto-submit'
}

export interface PiComposerPolicyOptions extends PiQueueControllerOptions {
  session: PiQueueSessionLike
  registry: CommandRegistry
  slashContext: SlashCommandContext
  model?: ModelSelection | null
  thinkingLevel?: ThinkingLevel
  thinkingControl?: boolean
  mentionedFiles?: string[] | (() => string[])
  composerBlocked?: boolean
  blockerMessage?: string
  isActiveSession?: () => boolean
  onBeforeSubmit?: (draft: string, context: { files: PromptInputFilePart[]; source: PiComposerSubmitInput['source'] }) => boolean | Promise<boolean>
  onCommandResult?: (message: string) => void
  onMentionedFilesConsumed?: () => void
  allowPromptDuringInitialHydration?: boolean
}

export type PiComposerBlockedReason =
  | Extract<PiQueueSubmitResult, { type: 'blocked' }>['reason']
  | 'composer-blocked'
  | 'inactive-session'
  | 'pre-submit-cancelled'

export type PiComposerSubmitResult =
  | { type: 'prompt'; clientNonce: string; cursor?: number; preserveDraft: false }
  | { type: 'followup'; clientNonce: string; clientSeq: number; cursor?: number; preserveDraft: false }
  | { type: 'command'; command: string; result?: string; preserveDraft: boolean }
  | { type: 'blocked'; reason: PiComposerBlockedReason; message: string; preserveDraft: true }

export class PiComposerPolicyController {
  private readonly queueController

  constructor(private readonly options: PiComposerPolicyOptions) {
    this.queueController = createPiFollowUpQueueController(options.session, options)
  }

  async submit(input: PiComposerSubmitInput): Promise<PiComposerSubmitResult> {
    const text = input.text.trim()
    const files = input.files ?? []
    const source = input.source ?? 'composer'

    if (this.options.composerBlocked) {
      return this.block('composer-blocked', this.options.blockerMessage ?? 'Composer is not ready yet.')
    }

    if (!(await this.runBeforeSubmit(input.text, files, source))) {
      return this.block('pre-submit-cancelled', 'Submit was cancelled before sending.')
    }

    if (this.options.isActiveSession && !this.options.isActiveSession()) {
      return this.block('inactive-session', 'The active session changed before the message was sent.')
    }

    const parsed = parseSlashCommand(text)
    if (parsed) {
      const command = this.options.registry.get(parsed.name)
      if (command?.kind === 'skill') {
        return this.submitExpandedText(skillCommandText(parsed.name, parsed.args), source, false)
      }
      if (command) return this.runLocalCommand(parsed.name, parsed.args)
    }

    if (isPiChatBusy(this.options.session.getState().status) && files.length > 0) {
      return this.fromQueueResult(await this.queueController.submit({ text, attachments: this.toAttachmentPayloads(files) }))
    }

    const { serverMessage, attachments } = await createEnrichedSubmitPayload({
      text,
      files,
      mentionedFiles: this.getMentionedFiles(),
    })
    if (this.options.isActiveSession && !this.options.isActiveSession()) {
      return this.block('inactive-session', 'The active session changed before the message was sent.')
    }

    const result = await this.queueController.submit({
      text: serverMessage,
      displayText: text,
      attachments,
      model: this.options.model ?? undefined,
      ...(this.options.thinkingControl ? { thinkingLevel: this.options.thinkingLevel ?? DEFAULT_THINKING } : {}),
    })
    if (result.type !== 'blocked') this.options.onMentionedFilesConsumed?.()
    return this.fromQueueResult(result)
  }

  async editQueued() {
    return this.queueController.editQueued()
  }

  interrupt() {
    return this.queueController.interrupt()
  }

  stop() {
    return this.queueController.stop()
  }

  private async submitExpandedText(text: string, source: PiComposerSubmitInput['source'], runBeforeSubmit = true): Promise<PiComposerSubmitResult> {
    if (runBeforeSubmit && !(await this.runBeforeSubmit(text, [], source))) {
      return this.block('pre-submit-cancelled', 'Submit was cancelled before sending.')
    }
    return this.fromQueueResult(await this.queueController.submit({
      text,
      kind: 'expanded-text',
      model: this.options.model ?? undefined,
      ...(this.options.thinkingControl ? { thinkingLevel: this.options.thinkingLevel ?? DEFAULT_THINKING } : {}),
    }))
  }

  private async runLocalCommand(commandName: string, args: string): Promise<PiComposerSubmitResult> {
    const command = this.options.registry.get(commandName)
    if (isPiChatBusy(this.options.session.getState().status) && command?.allowWhileBusy?.(args) !== true) {
      return this.block('busy-slash-command', 'Slash commands are not queued while the agent is responding.')
    }
    const result = await Promise.resolve(command?.handler(args, this.options.slashContext))
    const message = typeof result === 'string'
      ? result
      : result && typeof result === 'object'
        ? result.message
        : undefined
    const preserveDraft = Boolean(result && typeof result === 'object' && result.preserveDraft === true)
    if (message) this.options.onCommandResult?.(message)
    return { type: 'command', command: commandName, ...(message ? { result: message } : {}), preserveDraft }
  }

  private async runBeforeSubmit(draft: string, files: PromptInputFilePart[], source: PiComposerSubmitInput['source']): Promise<boolean> {
    const result = await this.options.onBeforeSubmit?.(draft, { files, source })
    return result !== false
  }

  private fromQueueResult(result: PiQueueSubmitResult): PiComposerSubmitResult {
    if (result.type === 'blocked') return { ...result, preserveDraft: true }
    return { ...result, preserveDraft: false }
  }

  private block(reason: Extract<PiComposerSubmitResult, { type: 'blocked' }>['reason'], message: string): PiComposerSubmitResult {
    this.options.onWarning?.(message)
    return { type: 'blocked', reason, message, preserveDraft: true }
  }

  private getMentionedFiles(): string[] {
    const mentioned = typeof this.options.mentionedFiles === 'function'
      ? this.options.mentionedFiles()
      : this.options.mentionedFiles
    return mentioned ?? []
  }

  private toAttachmentPayloads(files: PromptInputFilePart[]): ChatAttachmentPayload[] {
    return files.map((file) => ({
      filename: file.filename,
      mediaType: file.mediaType,
      url: file.url,
      ...(file.path ? { path: file.path } : {}),
    }))
  }
}

export function createPiComposerPolicyController(options: PiComposerPolicyOptions): PiComposerPolicyController {
  return new PiComposerPolicyController(options)
}

export function skillCommandText(name: string, args: string): string {
  const trimmedArgs = args.trim()
  return trimmedArgs ? `skill: ${name}\n\n${trimmedArgs}` : `skill: ${name}`
}

export function selectComposerHistoryFromCanonicalUsers(messages: readonly BoringChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === 'user' && message.status !== 'pending')
    .map((message) => message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim())
    .filter(Boolean)
}

export class InitialDraftAutoSubmitGuard {
  private restored = new Map<string, string>()
  private submitted = new Set<string>()

  shouldRestore(sessionId: string, draft: string | undefined): boolean {
    if (draft === undefined) return false
    if (this.restored.get(sessionId) === draft) return false
    this.restored.set(sessionId, draft)
    return true
  }

  claimAutoSubmit(sessionId: string, draft: string | undefined): boolean {
    const trimmed = draft?.trim()
    if (!trimmed) return false
    if (this.submitted.has(sessionId)) return false
    this.submitted.add(sessionId)
    return true
  }

  releaseAutoSubmit(sessionId: string): void {
    this.submitted.delete(sessionId)
  }
}

export function scopedComposerStorageKey(storageScope: string | undefined, suffix: string): string {
  const scope = storageScope && storageScope.length > 0 ? storageScope : DEFAULT_STORAGE_SCOPE
  return `${COMPOSER_SETTINGS_PREFIX}:${scope}:composer:${suffix}`
}

export function readPiComposerSettings(options: PiComposerSettingsStorageOptions = {}): PiComposerSettings {
  return {
    model: readStoredScopedModel(options),
    userSelectedModel: readStorage(options, 'model:user-selected') === '1',
    thinkingLevel: readStoredScopedThinking(options),
    showThoughts: readStorage(options, 'show-thoughts') === '1',
  }
}

export function writePiComposerModelSelection(model: ModelSelection | null, options: PiComposerSettingsStorageOptions = {}): void {
  if (!model) {
    removeStorage(options, 'model')
    removeStorage(options, 'model:user-selected')
    return
  }
  writeStorage(options, 'model', JSON.stringify(model))
  writeStorage(options, 'model:user-selected', '1')
}

export function writePiComposerThinking(value: ThinkingLevel, options: PiComposerSettingsStorageOptions = {}): void {
  writeStorage(options, 'thinking', value)
}

export function writePiComposerShowThoughts(value: boolean, options: PiComposerSettingsStorageOptions = {}): void {
  writeStorage(options, 'show-thoughts', value ? '1' : '0')
}

export function buildPromptPolicyPayload({
  message,
  clientNonce,
  model,
  thinkingLevel,
  thinkingControl,
  attachments,
}: {
  message: string
  clientNonce: string
  model?: ModelSelection | null
  thinkingLevel?: ThinkingLevel
  thinkingControl?: boolean
  attachments?: ChatAttachmentPayload[]
}): PromptPayload {
  return {
    message,
    clientNonce,
    ...(model ? { model } : {}),
    ...(thinkingControl ? { thinkingLevel: thinkingLevel ?? DEFAULT_THINKING } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  }
}

export function modelOptionsForSelection(options: AvailableModel[], _selected: ModelSelection | null): AvailableModel[] {
  return options.filter((model) => model.available)
}

function readStoredScopedModel(options: PiComposerSettingsStorageOptions): ModelSelection | null {
  const userSelected = readStorage(options, 'model:user-selected') === '1'
  if (!userSelected) return null
  return parseModelSelection(readStorage(options, 'model'))
}

function readStoredScopedThinking(options: PiComposerSettingsStorageOptions): ThinkingLevel {
  const raw = readStorage(options, 'thinking')
  return isThinkingLevel(raw) ? raw : DEFAULT_THINKING
}

function readStorage(options: PiComposerSettingsStorageOptions, suffix: string): string | null {
  const storage = resolveStorage(options.storage)
  if (!storage) return null
  try {
    return storage.getItem(scopedComposerStorageKey(options.storageScope, suffix))
  } catch {
    return null
  }
}

function writeStorage(options: PiComposerSettingsStorageOptions, suffix: string, value: string): void {
  const storage = resolveStorage(options.storage)
  if (!storage) return
  try {
    storage.setItem(scopedComposerStorageKey(options.storageScope, suffix), value)
  } catch {}
}

function removeStorage(options: PiComposerSettingsStorageOptions, suffix: string): void {
  const storage = resolveStorage(options.storage)
  if (!storage) return
  try {
    storage.removeItem(scopedComposerStorageKey(options.storageScope, suffix))
  } catch {}
}

function resolveStorage(storage: ActiveSessionStorageLike | undefined): ActiveSessionStorageLike | undefined {
  if (storage) return storage
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}
