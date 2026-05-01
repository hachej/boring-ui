/**
 * Bridge from the agent stream into the workspace event bus.
 *
 * Core keeps the stream packet opaque. Domain plugins translate packet shapes
 * they own into plugin-keyed events from their own bindings.
 */
import { events, workspaceEvents } from "./index"

export function emitAgentData(part: unknown): void {
  events.emit(workspaceEvents.agentData, { ts: Date.now(), part })
}
