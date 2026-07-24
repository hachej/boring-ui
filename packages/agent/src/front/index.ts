// @hachej/boring-agent/front — Tailwind + shadcn styled PiChatPanel, primitives, hooks, and slash commands.

export { uploadFile } from './upload/uploadFile'
export type { UploadFileOptions, UploadFileResult } from './upload/uploadFile'

export { PiChatPanel, PiChatPanel as ChatPanel } from './chat/PiChatPanel'
export type {
  AgentPluginReloadResult,
  ComposerBlocker,
  ComposerBlockerAction,
  PiChatPanelProps,
  PiChatPanelProps as ChatPanelProps,
} from './chat/PiChatPanel'
export { DebugDrawer } from './DebugDrawer'
export {
  ArtifactOpenProvider,
  useOpenArtifact,
  type OpenArtifactHandler,
} from './ArtifactOpenContext'
export { ChatEmptyState, defaultChatSuggestions } from './ChatEmptyState'
export type { ChatEmptyStateProps, ChatSuggestion } from './ChatEmptyState'
export { ModelSelect, ModelPickerMenu, ModelSelectTrigger, ThinkingSelect } from './chatPanelComposerControls'
export type { AvailableModel, ModelSelection, ThinkingLevel } from './chatPanelSettings'
export { getAgentCommands } from './commands'
export type { AgentCommandContribution, AgentCommandOptions } from './commands'
export { ComposerRecordingProvider, useComposerRecordingAdapter } from './chat/composerRecording'
export type { ComposerRecordingAdapter, ComposerRecordingSnapshot } from './chat/composerRecording'

// Hooks + slash commands
export {
  usePiSessions,
  activeSessionStorageKey,
  readActiveSessionId,
  writeActiveSessionId,
  clearActiveSessionId,
  SessionList as PiSessionList,
  SessionBrowser as PiSessionBrowser,
  searchPiSessions,
  parsePiSessionSearchQuery,
  matchPiSessionSearch,
} from './chat/session'
export type {
  UsePiSessionsOptions,
  UsePiSessionsResult,
  PiSessionCreateInit,
  SessionListProps,
  PiSessionSearchItem,
  PiSessionSearchOptions,
  PiSessionSearchSortMode,
} from './chat/session'
export {
  builtinCommands,
  createCommandRegistry,
  parseSlashCommand,
  type CommandRegistry,
  type ParsedCommand,
  type SlashCommand,
  type SlashCommandContext,
} from './slashCommands'
export {
  defaultToolRenderers,
  mergeToolRenderers,
  resolveToolRenderer,
  type ToolPart,
  type ToolRenderer,
  type ToolRendererOverrides,
} from './bareToolRenderers'
export { mergeShadcnToolRenderers } from './toolRenderers'
export { ToolCallGroup } from './primitives/tool-call-group'
export type { GroupedToolEntry } from './primitives/tool-call-group'

// Styled primitives (Tailwind + shadcn)
export {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  CodeBlock,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from './primitives'

// cn utility for consumers doing custom composition
export { cn } from './lib'
