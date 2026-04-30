import { events, userMeta } from "../events"
import type { UiCommand } from "./types"

export function postUiCommand(command: UiCommand): void {
  events.emit("ui:command", { ...userMeta(), command })
}
