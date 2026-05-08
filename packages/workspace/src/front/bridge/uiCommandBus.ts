import { events, userMeta, workspaceEvents } from "../events"
import type { UiCommand } from "./types"

export const WORKSPACE_UI_COMMAND_DOM_EVENT = "boring-ui:ui-command"

export function postUiCommand(command: UiCommand): void {
  events.emit(workspaceEvents.uiCommand, { ...userMeta(), command })
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_UI_COMMAND_DOM_EVENT, { detail: { command } }))
  }
}
