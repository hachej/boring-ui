/**
 * Workspace event bus — single in-process, typed pubsub for cross-cutting
 * signals. Module-singleton: import `events` anywhere in `@hachej/boring-workspace`
 * (and downstream packages that depend on it). React consumers should use
 * `useEvent(name, handler)` to handle cleanup automatically.
 *
 * See `packages/workspace/docs/plans/archive/UNIFIED_EVENT_BUS.md` for design + migration plan.
 */

import { createEventBus } from "./bus"
import type { WorkspaceEventMap } from "./types"

export const events = createEventBus<WorkspaceEventMap>()

export {
  userMeta,
  agentMeta,
  remoteMeta,
  workspaceEvents,
  WORKSPACE_PLUGIN_ID,
  WORKSPACE_UI_COMMAND_EVENT,
  WORKSPACE_EDITOR_SAVE_START_EVENT,
  WORKSPACE_EDITOR_SAVE_END_EVENT,
  WORKSPACE_PANEL_UPDATE_EVENT,
  WORKSPACE_PANEL_CLOSE_EVENT,
  WORKSPACE_AGENT_DATA_EVENT,
} from "./types"
export type {
  Origin,
  EventMeta,
  WorkspacePanelMatch,
  WorkspacePluginEventMap,
  WorkspaceEventMap,
  WorkspaceEventName,
} from "./types"

export { useEvent } from "./useEvent"
export { emitAgentData } from "./agentBridge"
