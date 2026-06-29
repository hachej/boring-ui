/**
 * Canonical event map for the workspace event bus.
 *
 * All in-process cross-cutting signals flow through one typed map.
 * Adding a new event = adding a key here.
 *
 * See `packages/workspace/docs/plans/archive/UNIFIED_EVENT_BUS.md` for the design rationale and
 * the planned future events. Those are intentionally NOT pre-declared
 * — they get added when their concrete emitter and consumer land in
 * the same step.
 */
import type { UiCommand } from "../bridge/types"

export const WORKSPACE_PLUGIN_ID = "workspace"
export const WORKSPACE_UI_COMMAND_EVENT = "workspace:ui.command"
export const WORKSPACE_EDITOR_SAVE_START_EVENT = "workspace:editor.save.start"
export const WORKSPACE_EDITOR_SAVE_END_EVENT = "workspace:editor.save.end"
export const WORKSPACE_PANEL_UPDATE_EVENT = "workspace:panel.update"
export const WORKSPACE_PANEL_CLOSE_EVENT = "workspace:panel.close"
export const WORKSPACE_AGENT_DATA_EVENT = "workspace:agent.data"

export const workspaceEvents = {
  uiCommand: WORKSPACE_UI_COMMAND_EVENT,
  editorSaveStart: WORKSPACE_EDITOR_SAVE_START_EVENT,
  editorSaveEnd: WORKSPACE_EDITOR_SAVE_END_EVENT,
  panelUpdate: WORKSPACE_PANEL_UPDATE_EVENT,
  panelClose: WORKSPACE_PANEL_CLOSE_EVENT,
  agentData: WORKSPACE_AGENT_DATA_EVENT,
} as const

export type WorkspacePanelMatch =
  | { id: string }
  | { param: string; value: unknown }
  | { paramPrefix: string; value: string }

/**
 * Discriminated origin metadata. Encoded as a union (rather than a
 * flat `cause` + optional `toolCallId`) so the type system enforces
 * that agent-originated events always carry a tool call id.
 */
export type Origin =
  | { cause: "user" }
  | { cause: "agent"; toolCallId: string }
  /**
   * Anything observed via the server-side fs watcher: a collaborator
   * editing the same workspace, a git pull, an external editor, the
   * agent in another tab. Carries the tool call id ONLY when the
   * server can attribute the change (sandbox emits its own writes
   * with attribution; chokidar can't). Consumers that want to
   * suppress UX side-effects on self-echo compare `actorClientId` (a
   * future field) against their own.
   */
  | { cause: "remote"; toolCallId?: string }

/** Common envelope on every payload. */
export type EventMeta = Origin & { ts: number }

/** Helper for emitting a user-originated event payload. */
export function userMeta(): { cause: "user"; ts: number } {
  return { cause: "user", ts: Date.now() }
}

export function agentMeta(
  toolCallId: string,
): { cause: "agent"; toolCallId: string; ts: number } {
  return { cause: "agent", toolCallId, ts: Date.now() }
}

export function remoteMeta(
  toolCallId?: string,
): { cause: "remote"; toolCallId?: string; ts: number } {
  return { cause: "remote", toolCallId, ts: Date.now() }
}

export interface WorkspaceHostEventMap {
  /** Shared UI manipulation contract used by the agent stream and plugin bindings. */
  [WORKSPACE_UI_COMMAND_EVENT]: EventMeta & { command: UiCommand }

  // Editor save lifecycle. Keyed by panelId, NOT path: a rename
  // mid-save would orphan a path-keyed badge. Subscribers map
  // panelId→path on their own when they need the path.
  [WORKSPACE_EDITOR_SAVE_START_EVENT]: { panelId: string }
  [WORKSPACE_EDITOR_SAVE_END_EVENT]: { panelId: string; ok?: boolean; error?: string }

  [WORKSPACE_PANEL_UPDATE_EVENT]: EventMeta & {
    match: WorkspacePanelMatch | WorkspacePanelMatch[]
    params?: Record<string, unknown>
    title?: string
  }
  [WORKSPACE_PANEL_CLOSE_EVENT]: EventMeta & {
    match: WorkspacePanelMatch | WorkspacePanelMatch[]
  }

  /**
   * Raw agent stream data observed by ChatPanelHost. Core treats this as an
   * opaque packet; plugins translate packets they understand into their own
   * plugin-keyed events.
   */
  [WORKSPACE_AGENT_DATA_EVENT]: { ts: number; part: unknown }
}

/**
 * Built-in plugin events baked into the public workspace event map.
 *
 * Filesystem events are declared inline (using EventMeta which is structurally
 * identical to FilesystemEventMeta) so the keys survive vite's rollupTypes
 * bundling without importing plugin-domain modules.
 *
 * Third-party plugins can extend this interface via declare module augmentation,
 * though that only works in source compilation — it does not survive dist bundling.
 */
export interface WorkspacePluginEventMap {
  "filesystem:file.changed": EventMeta & { path: string }
  "filesystem:file.created": EventMeta & { path: string; kind: "file" | "dir" }
  "filesystem:file.moved": EventMeta & { from: string; to: string }
  "filesystem:file.deleted": EventMeta & { path: string }
}

export interface WorkspaceEventMap
  extends WorkspaceHostEventMap,
    WorkspacePluginEventMap {}

/** Names that share a prefix can be filtered with `startsWith`. */
export type WorkspaceEventName = keyof WorkspaceEventMap
