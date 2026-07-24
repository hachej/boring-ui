import { useCallback } from 'react'
import type { ClickableMention } from './components/ClickableMention'
import type { PanelNotice } from './components/ChatNotices'
import type {
  CommandRegistry,
  SlashCommandContext,
  SlashCommandHandlerResult,
} from '../slashCommands'

interface UseSlashCommandUiOptions {
  registry: CommandRegistry
  activeChatSessionId?: string
  activeSessionId?: string
  sessionId?: string
  addLocalNotice: (notice: PanelNotice) => void
  resetSession: () => void
  reloadAgentPlugins: () => Promise<string>
  runPluginUpdate: () => Promise<string>
  openModelPicker: () => boolean | void
  selectComposerModel: (query: string) => string | void
  openThinkingPicker: () => boolean | void
  selectComposerThinking: (query: string) => string | void
  onCommandResult?: (message: string) => void
  dismissSlash: () => void
  insertSlashCommand: (name: string) => void
  setComposerDraft: (value: string, focus?: boolean) => void
}

function slashCommandResultMessage(result: SlashCommandHandlerResult): string | undefined {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && typeof result.message === 'string') return result.message
  return undefined
}

export function useSlashCommandUi({
  registry,
  activeChatSessionId,
  activeSessionId,
  sessionId,
  addLocalNotice,
  resetSession,
  reloadAgentPlugins,
  runPluginUpdate,
  openModelPicker,
  selectComposerModel,
  openThinkingPicker,
  selectComposerThinking,
  onCommandResult,
  dismissSlash,
  insertSlashCommand,
  setComposerDraft,
}: UseSlashCommandUiOptions) {
  const runSlashCommandFromUi = useCallback((name: string, options?: { clearDraftUnlessPreserved?: boolean }) => {
    const command = registry.get(name)
    if (!command || command.clickBehavior === 'disabled') return

    void (async () => {
      const currentSessionId = activeChatSessionId ?? activeSessionId ?? sessionId ?? 'default'
      const ctx: SlashCommandContext = {
        sessionId: currentSessionId,
        clearMessages: () => addLocalNotice({
          id: 'clear-not-supported',
          level: 'info',
          text: '/clear is not available in this chat panel.',
          dismissible: true,
        }),
        resetSession,
        listCommands: () => registry.list(),
        reloadAgentPlugins,
        pluginUpdate: { run: runPluginUpdate },
        openModelPicker,
        selectComposerModel,
        openThinkingPicker,
        selectComposerThinking,
      }
      const result = await Promise.resolve(command.handler('', ctx))
      const preserveDraft = Boolean(result && typeof result === 'object' && result.preserveDraft)
      if (options?.clearDraftUnlessPreserved && !preserveDraft) setComposerDraft('')
      const message = slashCommandResultMessage(result) ?? `/${name} triggered.`
      onCommandResult?.(message)
      addLocalNotice({ id: `command:${Date.now()}`, level: 'info', text: message, dismissible: true })
    })()
  }, [activeChatSessionId, activeSessionId, addLocalNotice, onCommandResult, openModelPicker, openThinkingPicker, registry, reloadAgentPlugins, resetSession, runPluginUpdate, selectComposerModel, selectComposerThinking, sessionId])

  const selectSlashCommand = useCallback((name: string) => {
    const command = registry.get(name)
    if (command?.clickBehavior === 'execute') {
      dismissSlash()
      runSlashCommandFromUi(name, { clearDraftUnlessPreserved: true })
      return
    }
    if (command?.clickBehavior === 'disabled') {
      dismissSlash()
      return
    }
    insertSlashCommand(name)
  }, [dismissSlash, insertSlashCommand, registry, runSlashCommandFromUi, setComposerDraft])

  const handleMentionClick = useCallback((mention: ClickableMention) => {
    if (mention.kind === 'skill') {
      const skillName = mention.value.replace(/^!/, '')
      if (skillName) setComposerDraft(`skill: ${skillName}\n\n`, true)
      return
    }

    if (mention.kind !== 'slash-command') return
    const name = mention.value.replace('/', '')
    const command = registry.get(name)
    if (!command || command.clickBehavior === 'disabled') return
    if (command.clickBehavior === 'insert') {
      setComposerDraft(`/${name} `, true)
      return
    }
    runSlashCommandFromUi(name)
  }, [registry, runSlashCommandFromUi, setComposerDraft])

  return { selectSlashCommand, handleMentionClick }
}
