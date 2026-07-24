import type { BoringChatMessage } from "@hachej/boring-agent/shared"
import { projectHandovers, type HandoverProjectionEvent, type ProjectedHandover } from "../../shared/artifacts"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function toolResultDetails(output: unknown): unknown {
  const value = record(output)
  return value && "details" in value ? value.details : output
}

export function projectChatHandovers(messages: readonly BoringChatMessage[]): ReadonlyMap<BoringChatMessage, ProjectedHandover> {
  const events: HandoverProjectionEvent[] = []
  const terminalMessages = new Map<string, BoringChatMessage>()

  for (const message of messages) {
    if (message.role === "user") {
      events.push({ type: "run-start", runId: message.piEntryId ?? message.id })
      continue
    }
    if (message.role !== "assistant") continue

    const toolParts = message.parts.filter((part) => part.type === "tool-call")
    for (const part of toolParts) {
      if (part.type !== "tool-call" || (part.state !== "output-available" && part.state !== "output-error")) continue
      events.push({
        type: "tool-result",
        entryId: part.id,
        isError: part.state === "output-error",
        details: toolResultDetails(part.output),
      })
    }

    const terminalEntryId = message.piEntryId ?? message.id
    if (message.runTerminalState) {
      events.push({
        type: "run-terminal",
        entryId: terminalEntryId,
        state: message.runTerminalState,
        ...(message.runTerminalState === "success" ? { createdAt: message.createdAt } : {}),
      })
      terminalMessages.set(terminalEntryId, message)
    }
  }

  const byMessage = new Map<BoringChatMessage, ProjectedHandover>()
  for (const handover of projectHandovers(events)) {
    const message = terminalMessages.get(handover.terminalEntryId)
    if (message) byMessage.set(message, handover)
  }
  return byMessage
}
