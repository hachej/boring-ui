import { events, userMeta, workspaceEvents } from "../events"
import type { UiCommand } from "./types"

export const UI_COMMAND_EVENT = "boring-workspace:ui-command"

export function postUiCommand(command: UiCommand): void {
  events.emit(workspaceEvents.uiCommand, { ...userMeta(), command })
  if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    globalThis.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, { detail: command }))
  }
}

/** @deprecated Use postUiCommand. */
export const emitUiEffect = postUiCommand
