import { describe, expect, it } from "vitest"
import type { BoringChatMessage } from "@hachej/boring-agent/shared"
import { projectChatHandovers } from "../handoverChatProjection"

const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
const operationOutput = {
  content: [{ type: "text", text: "registered" }],
  details: { kind: "boring.handover.operation", wireVersion: 1, operation: { action: "upsert", artifact } },
}

function successfulMessages(): BoringChatMessage[] {
  return [
    { id: "user-display", piEntryId: "user-native", role: "user", status: "done", parts: [{ type: "text", text: "Create a plan" }] },
    {
      id: "tool-display",
      piEntryId: "assistant-tool-native",
      role: "assistant",
      status: "done",
      parts: [{ type: "tool-call", id: "call-1", toolName: "manage_handover", input: {}, state: "output-available", output: operationOutput }],
    },
    { id: "final-display", piEntryId: "final-native", role: "assistant", status: "done", runTerminalState: "success", createdAt: "2026-01-01T00:00:00.000Z", parts: [{ type: "text", text: "Done." }] },
  ]
}

describe("projectChatHandovers", () => {
  it("attaches one deterministic Handover to the successful terminal assistant message", () => {
    const messages = successfulMessages()
    expect(projectChatHandovers(messages).get(messages[2]!)).toEqual({
      id: "handover:final-native",
      runId: "user-native",
      terminalEntryId: "final-native",
      createdAt: "2026-01-01T00:00:00.000Z",
      artifacts: [artifact],
    })
  })

  it("projects live same-turn assistant merges when the native terminal marker shares tool parts", () => {
    const messages = successfulMessages()
    const merged: BoringChatMessage[] = [messages[0]!, {
      ...messages[1]!,
      id: "merged-final",
      piEntryId: "final-native",
      runTerminalState: "success",
      parts: [...messages[1]!.parts, { type: "text", text: "Done." }],
    }]
    expect(projectChatHandovers(merged).get(merged[1]!)?.artifacts).toEqual([artifact])
  })

  it("suppresses failed, aborted, empty, and interrupted runs", () => {
    const failed = successfulMessages().map((message) => message.id === "final-display" ? { ...message, status: "error" as const, runTerminalState: "error" as const } : message)
    expect(projectChatHandovers(failed).size).toBe(0)

    const aborted = successfulMessages().map((message) => message.id === "final-display" ? { ...message, status: "aborted" as const, runTerminalState: "aborted" as const } : message)
    expect(projectChatHandovers(aborted).size).toBe(0)

    expect(projectChatHandovers([
      { id: "u", role: "user", status: "done", parts: [] },
      { id: "a", role: "assistant", status: "done", runTerminalState: "success", parts: [{ type: "text", text: "No outputs" }] },
    ]).size).toBe(0)

    expect(projectChatHandovers(successfulMessages().slice(0, 2)).size).toBe(0)
  })

  it("keeps repeated display message IDs isolated by row identity", () => {
    const first = successfulMessages()
    const second = successfulMessages().map((message) => ({
      ...message,
      id: message.id === "final-display" ? "final-display" : `${message.id}-second`,
      piEntryId: message.piEntryId ? `${message.piEntryId}-second` : undefined,
      parts: message.parts,
    }))
    const messages = [...first, ...second]
    const projected = projectChatHandovers(messages)
    expect(projected.get(first[2]!)?.id).toBe("handover:final-native")
    expect(projected.get(second[2]!)?.id).toBe("handover:final-native-second")
  })

  it("projects nested ask_user artifacts identically to manage_handover details", () => {
    const messages = successfulMessages()
    const toolMessage = messages[1]!
    const toolPart = toolMessage.parts[0]
    if (toolPart?.type !== "tool-call") throw new Error("expected tool call")
    toolPart.toolName = "ask_user"
    toolPart.output = { details: { status: "answered", handover: { kind: "boring.handover.operations", wireVersion: 1, operations: [{ action: "upsert", artifact }] } } }
    expect(projectChatHandovers(messages).get(messages[2]!)?.artifacts).toEqual([artifact])
  })
})
