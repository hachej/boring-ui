import { events, userMeta, workspaceEvents } from "../events"
import type { UiCommand } from "./types"

export const UI_COMMAND_EVENT = "boring-workspace:ui-command"

function globalEventTarget(): Partial<EventTarget> {
  return globalThis as unknown as Partial<EventTarget>
}

export function registerUiCommandConsumer(consume: (command: UiCommand) => void): () => void {
  const target = globalEventTarget()
  if (typeof target.addEventListener !== "function") return () => {}
  const handler = (event: Event) => {
    const command = (event as CustomEvent).detail
    if (command && typeof command === "object") consume(command as UiCommand)
  }
  target.addEventListener(UI_COMMAND_EVENT, handler)
  return () => target.removeEventListener?.(UI_COMMAND_EVENT, handler)
}

export function postUiCommand(command: UiCommand): void {
  events.emit(workspaceEvents.uiCommand, { ...userMeta(), command })
  const target = globalEventTarget()
  if (typeof target.dispatchEvent === "function" && typeof CustomEvent !== "undefined") {
    target.dispatchEvent(new CustomEvent(UI_COMMAND_EVENT, { detail: command }))
  }
}
