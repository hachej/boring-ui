/**
 * Browser event emitted after the runtime plugin registry applies a load/unload
 * event. Keep literal in sync with @hachej/boring-agent's composer listener;
 * do not import from agent here because workspace base front code must stay
 * agent-free.
 */
export const WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT = "boring-ui:agent-plugins-reloaded"
