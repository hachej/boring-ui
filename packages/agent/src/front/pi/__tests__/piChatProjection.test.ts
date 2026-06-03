// @vitest-environment jsdom
//
// Coverage for piChatProjection — previously zero-tested despite being the
// file that hosts the dedup/partId/projection logic we just fixed twice
// (data-pi-message-end fallback emitting duplicate text parts; partId="0"
// assumption breaking when pi's contentIndex > 0).
//
// Public surface:
//   - rebuildPiMessagesFromDataParts(messages)   — pure, rebuilds canonical
//     assistant messages from any data-pi-* parts present
//   - mergeRebuiltPiMessages(existing, rebuilt)  — pure, swap-by-id merge
//   - usePiChatProjection(...)                   — React hook driving the
//     live stream into piMessages state; handleData is the hot path
import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UIMessage } from "ai"
import { ErrorCode } from "../../../shared/error-codes"
import {
  mergeRebuiltPiMessages,
  rebuildPiMessagesFromDataParts,
  usePiChatProjection,
} from "../piChatProjection"

// Helpers — match the wire shape pi-coding-agent's stream-adapter emits.
function dataStart(messageId: string, role: "user" | "assistant", text?: string): UIMessage["parts"][number] {
  return { type: "data-pi-message-start", data: { messageId, role, ...(text ? { text } : {}) } } as unknown as UIMessage["parts"][number]
}
function dataEnd(messageId: string, role: "assistant" | "user", text?: string): UIMessage["parts"][number] {
  return { type: "data-pi-message-end", data: { messageId, role, ...(text ? { text } : {}) } } as unknown as UIMessage["parts"][number]
}
function textStart(messageId: string, partId: string): UIMessage["parts"][number] {
  return { type: "data-pi-text-start", data: { messageId, partId } } as unknown as UIMessage["parts"][number]
}
function textDelta(messageId: string, partId: string, delta: string): UIMessage["parts"][number] {
  return { type: "data-pi-text-delta", data: { messageId, partId, delta } } as unknown as UIMessage["parts"][number]
}
function textEnd(messageId: string, partId: string, text: string): UIMessage["parts"][number] {
  return { type: "data-pi-text-end", data: { messageId, partId, text } } as unknown as UIMessage["parts"][number]
}
function reasoningStart(messageId: string, partId: string): UIMessage["parts"][number] {
  return { type: "data-pi-reasoning-start", data: { messageId, partId } } as unknown as UIMessage["parts"][number]
}
function reasoningDelta(messageId: string, partId: string, delta: string): UIMessage["parts"][number] {
  return { type: "data-pi-reasoning-delta", data: { messageId, partId, delta } } as unknown as UIMessage["parts"][number]
}
function toolCallEnd(messageId: string, toolCallId: string, toolName: string, input: unknown): UIMessage["parts"][number] {
  return {
    type: "data-pi-tool-call-end",
    data: { messageId, toolCallId, toolName, input },
  } as unknown as UIMessage["parts"][number]
}
function toolResult(messageId: string, toolCallId: string, output: unknown, isError = false): UIMessage["parts"][number] {
  return {
    type: "data-pi-tool-result",
    data: { messageId, toolCallId, output, isError },
  } as unknown as UIMessage["parts"][number]
}
function makeMessage(id: string, role: "user" | "assistant", parts: UIMessage["parts"]): UIMessage {
  return { id, role, parts } as UIMessage
}

// Count NON-EMPTY text parts on a rebuilt message. Empty text parts
// (created by text-start before any delta fires) are normal and get
// filtered at render time by isBlankTextPart in ChatPanel. The dedup
// bug class is "user sees the SAME text twice" — two non-empty text
// parts with identical content. That's what this counter detects.
function textPartCount(msg: UIMessage | undefined): number {
  if (!msg) return 0
  return (msg.parts ?? []).filter((p) => {
    if (p.type !== "text") return false
    const text = (p as { text?: string }).text ?? ""
    return text.length > 0
  }).length
}
function firstTextPart(msg: UIMessage | undefined): string | undefined {
  if (!msg) return undefined
  const t = (msg.parts ?? []).find((p) => {
    if (p.type !== "text") return false
    const text = (p as { text?: string }).text ?? ""
    return text.length > 0
  }) as { text?: string } | undefined
  return t?.text
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("rebuildPiMessagesFromDataParts", () => {
  it("returns [] when no data-pi-* parts are present", () => {
    const messages: UIMessage[] = [makeMessage("u1", "user", [{ type: "text", text: "hi" } as UIMessage["parts"][number]])]
    expect(rebuildPiMessagesFromDataParts(messages)).toEqual([])
  })

  it("rebuilds a user message from message-start carrying text (user text rides message-start, not message-end)", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "user", [
        dataStart("u-1", "user", "hello"),
        dataEnd("u-1", "user", "hello"),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]!.id).toBe("u-1")
    expect(rebuilt[0]!.role).toBe("user")
    expect(firstTextPart(rebuilt[0])).toBe("hello")
  })

  it("rebuilds an assistant message from text-start + text-delta + text-end (partId=0)", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-1", "assistant"),
        textStart("a-1", "0"),
        textDelta("a-1", "0", "Hel"),
        textDelta("a-1", "0", "lo"),
        textEnd("a-1", "0", "Hello"),
        dataEnd("a-1", "assistant", "Hello"),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(textPartCount(rebuilt[0])).toBe(1)
    expect(firstTextPart(rebuilt[0])).toBe("Hello")
  })

  // REGRESSION: pi numbers content blocks across types. An assistant
  // message with reasoning at contentIndex 0 + text at contentIndex 1
  // produces text-* events with partId="1". data-pi-message-end has no
  // partId, so the old dedup defaulted to "0" and could NOT see the
  // existing "1" part → second text part appended → user sees the text
  // twice in the UI. Fixed by switching the message-end dedup to "any
  // text part has content".
  it("does NOT emit a duplicate text part when partId is non-zero (regression)", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-2", "assistant"),
        // reasoning is contentIndex 0 → text gets contentIndex 1
        reasoningStart("a-2", "0"),
        reasoningDelta("a-2", "0", "thinking…"),
        textStart("a-2", "1"),
        textDelta("a-2", "1", "I'll improve the title."),
        textEnd("a-2", "1", "I'll improve the title."),
        dataEnd("a-2", "assistant", "I'll improve the title."),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(textPartCount(rebuilt[0])).toBe(1)
    expect(firstTextPart(rebuilt[0])).toBe("I'll improve the title.")
  })

  it("falls back to message-end's text when no text-end fires (single-shot emission)", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-3", "assistant"),
        dataEnd("a-3", "assistant", "Done."),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(firstTextPart(rebuilt[0])).toBe("Done.")
  })

  it("preserves tool-call ordering relative to text and reasoning", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-4", "assistant"),
        reasoningStart("a-4", "0"),
        reasoningDelta("a-4", "0", "plan"),
        toolCallEnd("a-4", "call-1", "read", { path: "README.md" }),
        toolResult("a-4", "call-1", [{ type: "text", text: "# Hello" }]),
        textStart("a-4", "2"),
        textDelta("a-4", "2", "Read it."),
        textEnd("a-4", "2", "Read it."),
        dataEnd("a-4", "assistant", "Read it."),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    const types = (rebuilt[0]!.parts ?? []).map((p) => p.type)
    // Reasoning + tool + text all present.
    expect(types).toContain("reasoning")
    expect(types).toContain("tool-read")
    expect(types).toContain("text")
    // And exactly ONE text part, not duplicated.
    expect(textPartCount(rebuilt[0])).toBe(1)
  })

  it("attaches tool-result output to the same tool-call part (no duplicate tool entries)", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-5", "assistant"),
        toolCallEnd("a-5", "call-x", "edit", { path: "x.md" }),
        toolResult("a-5", "call-x", "ok"),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    const toolParts = (rebuilt[0]!.parts ?? []).filter((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    )
    expect(toolParts).toHaveLength(1)
    expect((toolParts[0] as { state?: string }).state).toBe("output-available")
  })

  it("preserves structured WORKSPACE_NOT_READY tool-result details", () => {
    const output = {
      content: [{ type: "text", text: "Workspace is still preparing. Try again in a moment." }],
      details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, requirement: "workspace-fs" },
    }
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-ready", "assistant"),
        toolCallEnd("a-ready", "call-ready", "read", { path: "README.md" }),
        toolResult("a-ready", "call-ready", output, true),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    const toolPart = (rebuilt[0]!.parts ?? []).find((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    ) as { state?: string; output?: typeof output }
    expect(toolPart.state).toBe("output-error")
    expect(toolPart.output?.details).toEqual({
      code: ErrorCode.enum.WORKSPACE_NOT_READY,
      retryable: true,
      requirement: "workspace-fs",
    })
  })

  it("preserves structured AGENT_RUNTIME_NOT_READY tool-result details", () => {
    const output = {
      content: [{ type: "text", text: "The macro Python runtime is still installing. This usually takes a few seconds." }],
      details: {
        code: ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
        retryable: true,
        requirement: "runtime:python",
        state: "preparing",
        workspaceId: "workspace-a",
      },
    }
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-runtime", "assistant"),
        toolCallEnd("a-runtime", "call-runtime", "bash", { command: "bm run" }),
        toolResult("a-runtime", "call-runtime", output, true),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    const toolPart = (rebuilt[0]!.parts ?? []).find((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    ) as { state?: string; output?: typeof output }
    expect(toolPart.state).toBe("output-error")
    expect(toolPart.output?.details).toEqual(output.details)
  })

  it("marks tool-result as output-error when isError=true", () => {
    const messages: UIMessage[] = [
      makeMessage("envelope", "assistant", [
        dataStart("a-6", "assistant"),
        toolCallEnd("a-6", "call-e", "find", { pattern: "**/*" }),
        toolResult("a-6", "call-e", "path outside workspace", true),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    const toolPart = (rebuilt[0]!.parts ?? []).find((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    ) as { state?: string }
    expect(toolPart.state).toBe("output-error")
  })

  it("rebuilds multiple assistant turns into separate messages", () => {
    const messages: UIMessage[] = [
      makeMessage("env", "assistant", [
        dataStart("a-a", "assistant"),
        textStart("a-a", "0"),
        textEnd("a-a", "0", "first"),
        dataEnd("a-a", "assistant", "first"),
        dataStart("a-b", "assistant"),
        textStart("a-b", "0"),
        textEnd("a-b", "0", "second"),
        dataEnd("a-b", "assistant", "second"),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(rebuilt.map((m) => m.id)).toEqual(["a-a", "a-b"])
    expect(firstTextPart(rebuilt[0])).toBe("first")
    expect(firstTextPart(rebuilt[1])).toBe("second")
  })

  it("skips parts that have no messageId", () => {
    const messages: UIMessage[] = [
      makeMessage("env", "assistant", [
        { type: "data-pi-message-start", data: { role: "assistant" } } as unknown as UIMessage["parts"][number],
        dataStart("a-good", "assistant"),
        dataEnd("a-good", "assistant", "kept"),
      ]),
    ]
    const rebuilt = rebuildPiMessagesFromDataParts(messages)
    expect(rebuilt.map((m) => m.id)).toEqual(["a-good"])
  })

  it("ignores non-pi text parts in the input (only data-pi-* trigger rebuild)", () => {
    const messages: UIMessage[] = [
      makeMessage("u1", "user", [{ type: "text", text: "hello" } as UIMessage["parts"][number]]),
    ]
    expect(rebuildPiMessagesFromDataParts(messages)).toEqual([])
  })
})

describe("mergeRebuiltPiMessages", () => {
  it("returns existing unchanged when rebuilt is empty", () => {
    const existing: UIMessage[] = [makeMessage("u1", "user", [])]
    expect(mergeRebuiltPiMessages(existing, [])).toBe(existing)
  })

  it("swaps existing messages with the same id for the rebuilt version", () => {
    const oldA = makeMessage("a-1", "assistant", [])
    const newA = makeMessage("a-1", "assistant", [{ type: "text", text: "new" } as UIMessage["parts"][number]])
    const merged = mergeRebuiltPiMessages([oldA], [newA])
    expect(merged).toHaveLength(1)
    expect(firstTextPart(merged[0])).toBe("new")
  })

  it("drops existing messages that carry only data-pi-* parts (they're stale stream envelopes)", () => {
    const staleEnvelope = makeMessage("env", "assistant", [
      dataStart("a-new", "assistant"),
      dataEnd("a-new", "assistant", "rebuilt"),
    ])
    const rebuilt = makeMessage("a-new", "assistant", [
      { type: "text", text: "rebuilt" } as UIMessage["parts"][number],
    ])
    const merged = mergeRebuiltPiMessages([staleEnvelope], [rebuilt])
    // The envelope (with data-pi-* parts) is dropped; only the rebuilt remains.
    expect(merged.map((m) => m.id)).toEqual(["a-new"])
    expect(firstTextPart(merged[0])).toBe("rebuilt")
  })

  it("preserves existing messages that have NO data-pi-* parts and a different id", () => {
    const userMsg = makeMessage("u-1", "user", [{ type: "text", text: "hi" } as UIMessage["parts"][number]])
    const assistantRebuilt = makeMessage("a-1", "assistant", [
      { type: "text", text: "yo" } as UIMessage["parts"][number],
    ])
    const merged = mergeRebuiltPiMessages([userMsg], [assistantRebuilt])
    expect(merged).toHaveLength(2)
    expect(merged[0]!.id).toBe("u-1")
    expect(merged[1]!.id).toBe("a-1")
  })

  it("skips rebuilt pi user messages that are already represented by SDK user turns", () => {
    const sdkUser = makeMessage("sdk-u-1", "user", [{ type: "text", text: "same prompt" } as UIMessage["parts"][number]])
    const piUser = makeMessage("pi-u-1", "user", [{ type: "text", text: "same prompt" } as UIMessage["parts"][number]])
    const assistantRebuilt = makeMessage("a-1", "assistant", [
      { type: "text", text: "reply" } as UIMessage["parts"][number],
    ])

    const merged = mergeRebuiltPiMessages([sdkUser], [piUser, assistantRebuilt])

    expect(merged.map((message) => message.id)).toEqual(["sdk-u-1", "a-1"])
  })

  it("keeps a rebuilt user when it replaces an SDK user with the same id", () => {
    const sdkUser = makeMessage("u-same", "user", [{ type: "text", text: "same prompt" } as UIMessage["parts"][number]])
    const piUser = makeMessage("u-same", "user", [{ type: "text", text: "same prompt" } as UIMessage["parts"][number]])

    const merged = mergeRebuiltPiMessages([sdkUser], [piUser])

    expect(merged.map((message) => message.id)).toEqual(["u-same"])
    expect(firstTextPart(merged[0])).toBe("same prompt")
  })
})

describe("usePiChatProjection (live handleData stream)", () => {
  const baseProps = { messages: [], status: "ready", sessionId: "s-1" }

  it("starts with empty piMessages", () => {
    const { result } = renderHook(() => usePiChatProjection(baseProps))
    expect(result.current.piMessages).toEqual([])
  })

  it("handleData with message-start + text events produces one text part", () => {
    const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-1", role: "assistant" } })
      result.current.handleData({ type: "data-pi-text-start", data: { messageId: "a-1", partId: "0" } })
      result.current.handleData({ type: "data-pi-text-delta", data: { messageId: "a-1", partId: "0", delta: "Hello" } })
      result.current.handleData({ type: "data-pi-text-end", data: { messageId: "a-1", partId: "0", text: "Hello" } })
    })
    expect(result.current.piMessages).toHaveLength(1)
    expect(textPartCount(result.current.piMessages[0])).toBe(1)
    expect(firstTextPart(result.current.piMessages[0])).toBe("Hello")
  })

  // REGRESSION (live): same partId-mismatch case as the rebuild test, but
  // through the live handleData hot path. message-end with no partId would
  // default to "0", miss the existing text part at partId "1", and append
  // a SECOND text part. The UI then renders two identical text bubbles.
  it("does NOT duplicate text when message-end fires after a non-zero-partId text-end (regression)", () => {
    const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-2", role: "assistant" } })
      result.current.handleData({ type: "data-pi-reasoning-start", data: { messageId: "a-2", partId: "0" } })
      result.current.handleData({ type: "data-pi-reasoning-delta", data: { messageId: "a-2", partId: "0", delta: "think" } })
      result.current.handleData({ type: "data-pi-text-start", data: { messageId: "a-2", partId: "1" } })
      result.current.handleData({ type: "data-pi-text-delta", data: { messageId: "a-2", partId: "1", delta: "I'll do it." } })
      result.current.handleData({ type: "data-pi-text-end", data: { messageId: "a-2", partId: "1", text: "I'll do it." } })
      // message-end with NO partId — defaults to "0" on the client side
      result.current.handleData({ type: "data-pi-message-end", data: { messageId: "a-2", role: "assistant", text: "I'll do it." } })
    })
    expect(textPartCount(result.current.piMessages[0])).toBe(1)
    expect(firstTextPart(result.current.piMessages[0])).toBe("I'll do it.")
  })

  it("tool-call-end then tool-result attaches output without duplicating the tool part", () => {
    const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-3", role: "assistant" } })
      result.current.handleData({ type: "data-pi-tool-call-end", data: { messageId: "a-3", toolCallId: "c-1", toolName: "read", input: { path: "x" } } })
      result.current.handleData({ type: "data-pi-tool-result", data: { messageId: "a-3", toolCallId: "c-1", output: "ok", isError: false } })
    })
    const toolParts = (result.current.piMessages[0]!.parts ?? []).filter((p) =>
      typeof p.type === "string" && p.type.startsWith("tool-"),
    )
    expect(toolParts).toHaveLength(1)
    expect((toolParts[0] as { state?: string }).state).toBe("output-available")
  })

  it("live projection preserves structured WORKSPACE_NOT_READY tool output", () => {
    const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
    const output = {
      content: [{ type: "text", text: "Workspace is still preparing. Try again in a moment." }],
      details: { code: ErrorCode.enum.WORKSPACE_NOT_READY, retryable: true, requirement: "workspace-fs" },
    }
    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-ready", role: "assistant" } })
      result.current.handleData({ type: "data-pi-tool-call-end", data: { messageId: "a-ready", toolCallId: "call-ready", toolName: "read", input: { path: "README.md" } } })
      result.current.handleData({ type: "data-pi-tool-result", data: { messageId: "a-ready", toolCallId: "call-ready", output, isError: true } })
    })
    const toolPart = result.current.piMessages[0]?.parts?.find((part) =>
      typeof part.type === "string" && part.type.startsWith("tool-"),
    ) as { state?: string; output?: typeof output } | undefined
    expect(toolPart?.state).toBe("output-error")
    expect(toolPart?.output?.details).toEqual(output.details)
  })

  it("clears piMessages when sessionId changes (no cross-session bleed)", () => {
    const props = { ...baseProps, status: "streaming" as const, sessionId: "s-1" }
    const { result, rerender } = renderHook(
      ({ sessionId }) => usePiChatProjection({ ...props, sessionId }),
      { initialProps: { sessionId: "s-1" } },
    )
    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-x", role: "assistant" } })
      result.current.handleData({ type: "data-pi-message-end", data: { messageId: "a-x", role: "assistant", text: "leftover" } })
    })
    expect(result.current.piMessages).toHaveLength(1)
    rerender({ sessionId: "s-2" })
    expect(result.current.piMessages).toEqual([])
  })

  it("batches tiny live text deltas before updating React state", () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
      act(() => {
        result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-batch", role: "assistant" } })
        result.current.handleData({ type: "data-pi-text-start", data: { messageId: "a-batch", partId: "0" } })
        result.current.handleData({ type: "data-pi-text-delta", data: { messageId: "a-batch", partId: "0", delta: "Hel" } })
        result.current.handleData({ type: "data-pi-text-delta", data: { messageId: "a-batch", partId: "0", delta: "lo" } })
      })
      expect(firstTextPart(result.current.piMessages[0])).toBeUndefined()

      act(() => vi.advanceTimersByTime(49))
      expect(firstTextPart(result.current.piMessages[0])).toBeUndefined()

      act(() => vi.advanceTimersByTime(1))
      expect(firstTextPart(result.current.piMessages[0])).toBe("Hello")
    } finally {
      vi.useRealTimers()
    }
  })

  it("text-end flushes buffered deltas and repairs partial text with final text", () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
      act(() => {
        result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-final", role: "assistant" } })
        result.current.handleData({ type: "data-pi-text-start", data: { messageId: "a-final", partId: "0" } })
        result.current.handleData({ type: "data-pi-text-delta", data: { messageId: "a-final", partId: "0", delta: "Hel" } })
        result.current.handleData({ type: "data-pi-text-end", data: { messageId: "a-final", partId: "0", text: "Hello" } })
      })
      expect(firstTextPart(result.current.piMessages[0])).toBe("Hello")
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not rebuild from AI SDK data envelopes while streaming (live deltas stay smooth)", () => {
    const envelope = makeMessage("env", "assistant", [
      dataStart("a-env", "assistant"),
      textStart("a-env", "0"),
      textDelta("a-env", "0", "partial"),
      textEnd("a-env", "0", "partial then final snapshot"),
      dataEnd("a-env", "assistant", "partial then final snapshot"),
    ])
    const { result, rerender } = renderHook(
      ({ messages, status }) => usePiChatProjection({ ...baseProps, messages, status }),
      { initialProps: { messages: [] as UIMessage[], status: "streaming" } },
    )

    rerender({ messages: [envelope], status: "streaming" })
    expect(result.current.piMessages).toEqual([])

    rerender({ messages: [envelope], status: "ready" })
    expect(firstTextPart(result.current.piMessages[0])).toBe("partial")
  })

  it("preserves repeated same-text SDK user turns when persisting", () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    const firstUserTurn = makeMessage("u-1", "user", [
      { type: "text", text: "retry" } as UIMessage["parts"][number],
    ])
    const secondUserTurn = makeMessage("u-2", "user", [
      { type: "text", text: "retry" } as UIMessage["parts"][number],
    ])
    const assistant = makeMessage("a-1", "assistant", [
      { type: "text", text: "assistant reply" } as UIMessage["parts"][number],
    ])

    const { result, rerender } = renderHook(
      ({ messages, status }) => usePiChatProjection({
        messages,
        status,
        sessionId: "sess-repeat-users",
      }),
      {
        initialProps: {
          messages: [firstUserTurn, secondUserTurn, assistant] as UIMessage[],
          status: "streaming",
        },
      },
    )

    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-1", role: "assistant" } })
      result.current.handleData({ type: "data-pi-text-end", data: { messageId: "a-1", partId: "0", text: "assistant reply" } })
    })

    rerender({
      messages: [firstUserTurn, secondUserTurn, assistant],
      status: "ready",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      messages: [
        { id: "u-1", role: "user", parts: [{ type: "text", text: "retry" }] },
        { id: "u-2", role: "user", parts: [{ type: "text", text: "retry" }] },
        { id: "a-1", role: "assistant", parts: [{ type: "text", text: "assistant reply" }] },
      ],
    })
  })

  it("persists canonical pi history instead of raw assistant-only envelopes after a turn settles", () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    const userTurn = makeMessage("u-1", "user", [
      { type: "text", text: "draft after sign-in" } as UIMessage["parts"][number],
    ])
    const assistantEnvelope = makeMessage("env-1", "assistant", [
      dataStart("a-1", "assistant"),
      textStart("a-1", "0"),
      textEnd("a-1", "0", "assistant reply"),
      dataEnd("a-1", "assistant", "assistant reply"),
    ])

    const { result, rerender } = renderHook(
      ({ messages, status }) => usePiChatProjection({
        messages,
        status,
        sessionId: "sess-persist",
      }),
      {
        initialProps: {
          messages: [userTurn, assistantEnvelope] as UIMessage[],
          status: "streaming",
        },
      },
    )

    act(() => {
      result.current.handleData({ type: "data-pi-message-start", data: { messageId: "a-1", role: "assistant" } })
      result.current.handleData({ type: "data-pi-text-start", data: { messageId: "a-1", partId: "0" } })
      result.current.handleData({ type: "data-pi-text-end", data: { messageId: "a-1", partId: "0", text: "assistant reply" } })
    })

    rerender({
      messages: [userTurn, assistantEnvelope],
      status: "ready",
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [input, init] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined]
    expect(init?.method).toBe("PUT")
    expect(String(input)).toBe("/api/v1/agent/chat/sess-persist/messages")
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [
        {
          id: "u-1",
          role: "user",
          parts: [{ type: "text", text: "draft after sign-in" }],
        },
        {
          id: "a-1",
          role: "assistant",
          parts: [{ type: "text", text: "assistant reply" }],
        },
      ],
    })
  })

  it("handleData with unknown type is a no-op (forward compatibility)", () => {
    const { result } = renderHook(() => usePiChatProjection({ ...baseProps, status: "streaming" }))
    act(() => {
      result.current.handleData({ type: "data-pi-future-event", data: { messageId: "a", whatever: 1 } })
    })
    expect(result.current.piMessages).toEqual([])
  })
})
