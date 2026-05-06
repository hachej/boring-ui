// @boring/agent/front — Tailwind + shadcn styled ChatPanel, primitives, hooks, and slash commands.

export { ChatPanel } from './ChatPanel'
export type { ChatPanelProps } from './ChatPanel'
export { DebugDrawer } from './DebugDrawer'
export {
  ArtifactOpenProvider,
  useOpenArtifact,
  type OpenArtifactHandler,
} from './ArtifactOpenContext'
export { ChatEmptyState, defaultChatSuggestions } from './ChatEmptyState'
export type { ChatEmptyStateProps, ChatSuggestion } from './ChatEmptyState'
export { getAgentCommands } from './commands'
export type { AgentCommandContribution, AgentCommandOptions } from './commands'

// Hooks + slash commands
export { useAgentChat } from './hooks/useAgentChat'
export type { UseAgentChatOptions } from './hooks/useAgentChat'
export { useSessions } from './hooks/useSessions'
export type { UseSessionsOptions, UseSessionsResult } from './hooks/useSessions'
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
  DiffView,
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
  MessageToolbar,
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
  CodeBlock,
  CodeBlockContainer,
  CodeBlockHeader,
  CodeBlockContent,
  CodeBlockCopyButton,
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputButton,
  Shimmer,
} from './primitives'

// cn utility for consumers doing custom composition
export { cn } from './lib'
