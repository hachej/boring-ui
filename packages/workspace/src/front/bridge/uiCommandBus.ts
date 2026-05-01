import { events, userMeta, workspaceEvents } from "../events"
import type { UiCommand } from "./types"

export function postUiCommand(command: UiCommand): void {
  events.emit(workspaceEvents.uiCommand, { ...userMeta(), command })
}
