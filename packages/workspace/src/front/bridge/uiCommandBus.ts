import { events, userMeta, workspaceEvents } from "../events"
import type { UiCommand } from "./types"

export const UI_COMMAND_EVENT = "boring-workspace:ui-command"

export function registerUiCommandConsumer(consume: (command: UiCommand) => void): () => void {
  if (typeof globalThis.addEventListener !== "function") return () => {}
  const handler = (event: Event) => {
    const command = (event as CustomEvent).detail
    if (command && typeof command === "object") consume(command as UiCommand)
  }
  globalThis.addEventListener(UI_COMMAND_EVENT, handler)
  return () => globalThis.removeEventListener?.(UI_COMMAND_EVENT, handler)
}

export function postUiCommand(command: UiCommand): void {
  events.emit(workspaceEvents.uiCommand, { ...userMeta(), command })
  if (typeof globalThis.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    globalThis.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, { detail: command }))
  }
}
