// @boring/agent — frontend (React) public API
export { ChatPanel } from './ChatPanel'
export { SessionToolbar } from './components/SessionToolbar'
export { useSessions } from './hooks/useSessions'
export type { UseSessionsResult } from './hooks/useSessions'
export {
  DiffView,
  defaultToolRenderers,
  mergeToolRenderers,
  resolveToolRenderer,
  type ToolPart,
  type ToolRenderer,
  type ToolRendererOverrides,
} from './toolRenderers'
export {
  builtinCommands,
  createCommandRegistry,
  parseSlashCommand,
  type CommandRegistry,
  type ParsedCommand,
  type SlashCommand,
  type SlashCommandContext,
} from './slashCommands'
