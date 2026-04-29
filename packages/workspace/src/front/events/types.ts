/**
 * Canonical event map for the workspace event bus.
 *
 * All in-process cross-cutting signals flow through one typed map.
 * Adding a new event = adding a key here.
 *
 * See `docs/plans/UNIFIED_EVENT_BUS.md` for the design rationale and
 * the planned future events. Those are intentionally NOT pre-declared
 * — they get added when their concrete emitter and consumer land in
 * the same step.
 */

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

/** Helper for emitting: `events.emit('file:moved', { ...userMeta(), from, to })`. */
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

/**
 * Canonical event map. Colon-namespaced keys (`domain:verb`) so
 * consumers can prefix-filter (`file:*`) — matches cmdk + vscode.
 */
export interface WorkspaceEventMap {
  "file:moved": EventMeta & { from: string; to: string }
  "file:deleted": EventMeta & { path: string }
  "file:created": EventMeta & { path: string; kind: "file" | "dir" }
  /** Content-only mutation (overwrite, edit). */
  "file:changed": EventMeta & { path: string }

  // Editor save lifecycle. Keyed by panelId, NOT path: a rename
  // mid-save would orphan a path-keyed badge. Subscribers map
  // panelId→path on their own when they need the path.
  "editor:save:start": { panelId: string }
  "editor:save:end": { panelId: string; ok?: boolean; error?: string }
}

/** Names that share a prefix can be filtered with `startsWith`. */
export type WorkspaceEventName = keyof WorkspaceEventMap
