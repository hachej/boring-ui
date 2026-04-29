// @boring/agent/ui-shadcn — Tailwind + shadcn styled ChatPanel and primitives
// Requires tailwindcss as peerDep. For zero-Tailwind usage, use @boring/agent (bare primitives).

export { ChatPanel } from './ChatPanel'
export type { ChatPanelProps } from './ChatPanel'
export {
  ArtifactOpenProvider,
  useOpenArtifact,
  type OpenArtifactHandler,
} from './ArtifactOpenContext'
export { ChatEmptyState, defaultChatSuggestions } from './ChatEmptyState'
export type { ChatEmptyStateProps, ChatSuggestion } from './ChatEmptyState'

// Re-export hooks and slash commands from the base package (shared between both APIs)
export { useAgentChat } from '../front/hooks/useAgentChat'
export type { UseAgentChatOptions } from '../front/hooks/useAgentChat'
export { useSessions } from '../front/hooks/useSessions'
export type { UseSessionsResult } from '../front/hooks/useSessions'
export {
  builtinCommands,
  createCommandRegistry,
  parseSlashCommand,
  type CommandRegistry,
  type ParsedCommand,
  type SlashCommand,
  type SlashCommandContext,
} from '../front/slashCommands'
export {
  DiffView,
  defaultToolRenderers,
  mergeToolRenderers,
  resolveToolRenderer,
  type ToolPart,
  type ToolRenderer,
  type ToolRendererOverrides,
} from '../front/toolRenderers'

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
