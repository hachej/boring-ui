/**
 * Browser CustomEvent name dispatched on `window` after the workspace's
 * agent-plugin hot reload subscriber commits a registry change (load,
 * unload, or error).
 *
 * Declared in `@hachej/boring-agent` (not `@hachej/boring-workspace`)
 * so the agent's ChatPanel — which listens for this event to refresh
 * its slash-command palette / banner state — can import it without
 * creating a workspace → agent → workspace cycle. Workspace's
 * `useAgentPluginHotReload` imports the same constant.
 */
export const WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT = "boring-ui:agent-plugins-reloaded"

/**
 * One per plugin that loaded successfully but whose server-side surfaces
 * (Fastify routes / agent tools) still hold pre-reload code. Shared
 * between the agent's /reload HTTP route + the ChatPanel banner so the
 * agent layer has ONE declaration of this wire shape. Mirrors what the
 * workspace's `collectRestartWarnings()` emits (workspace owns the
 * canonical `PluginRestartWarning` type; we redeclare here only because
 * the agent layer must not depend on workspace).
 */
export interface PluginRestartWarning {
  id: string
  surfaces: string[]
  message: string
}

/**
 * Browser CustomEvent name dispatched on `window` when a `showNotification`
 * UI command arrives from the server (e.g. from a plugin slash command that
 * calls `notify()`). `PiChatPanel` listens for this to show the
 * `CommandRunStatus` banner above the composer.
 */
export const WORKSPACE_COMMAND_NOTIFY_EVENT = 'boring-ui:command-notify'

/**
 * Payload carried by `WORKSPACE_COMMAND_NOTIFY_EVENT`. Maps directly to
 * what `uiCommandDispatcher` extracts from the `showNotification` command.
 */
export interface CommandNotifyPayload {
  message: string
  tone: 'success' | 'error' | 'info'
}
