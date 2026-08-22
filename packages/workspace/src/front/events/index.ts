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

const WORKSPACE_EVENT_BUS_GLOBAL_KEY = "__BORING_WORKSPACE_EVENT_BUS_V1__" as const
type WorkspaceEventBus = ReturnType<typeof createEventBus<WorkspaceEventMap>>
const browserRealm = globalThis as typeof globalThis & {
  [WORKSPACE_EVENT_BUS_GLOBAL_KEY]?: WorkspaceEventBus
}

/** Separately bundled plugin entrypoints must publish and subscribe through one browser-realm bus. */
export const events = browserRealm[WORKSPACE_EVENT_BUS_GLOBAL_KEY]
  ?? (browserRealm[WORKSPACE_EVENT_BUS_GLOBAL_KEY] = createEventBus<WorkspaceEventMap>())

export {
  userMeta,
  agentMeta,
  remoteMeta,
  workspaceEvents,
  WORKSPACE_PLUGIN_ID,
  WORKSPACE_UI_COMMAND_EVENT,
  WORKSPACE_UI_STATE_INVALIDATED_EVENT,
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
