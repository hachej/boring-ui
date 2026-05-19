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
