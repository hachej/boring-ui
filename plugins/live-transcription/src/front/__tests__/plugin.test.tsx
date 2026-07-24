import { createElement } from "react"
import { act, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@hachej/boring-workspace", () => ({
  MarkdownEditorPane: ({ params }: { params?: { path?: string; mode?: string } }) => (
    <div data-testid="markdown" data-path={params?.path} data-mode={params?.mode} />
  ),
  postUiCommand: vi.fn(),
}))

import { liveTranscriptBrowserState } from "../state"
import { LiveTranscriptMarkdownPane, liveTranscriptCommands, liveTranscriptPlugin } from "../index"

describe("live transcript front surface", () => {
  beforeEach(() => liveTranscriptBrowserState.set({}))

  it("marks only exact stop/status/review controls busy-safe", () => {
    const live = liveTranscriptCommands.find((command) => command.name === "live")!
    const review = liveTranscriptCommands.find((command) => command.name === "review")!
    expect(live.allowWhileBusy?.("stop")).toBe(true)
    expect(live.allowWhileBusy?.(" status ")).toBe(true)
    expect(live.allowWhileBusy?.("start Weekly sync")).toBe(false)
    expect(live.allowWhileBusy?.("stop now")).toBe(false)
    expect(review.allowWhileBusy?.("transcript")).toBe(true)
    expect(review.allowWhileBusy?.("transcript now")).toBe(false)
  })

  it("wins only for the exact active path", () => {
    const registrations: { panels: any[]; resolvers: any[]; bindings: any[] } = { panels: [], resolvers: [], bindings: [] }
    liveTranscriptPlugin({
      registerPanel: (value: unknown) => registrations.panels.push(value),
      registerSurfaceResolver: (value: unknown) => registrations.resolvers.push(value),
      registerBinding: (value: unknown) => registrations.bindings.push(value),
    } as never)
    const resolver = registrations.resolvers[0]

    liveTranscriptBrowserState.set({ liveSessionId: "live-1", transcriptPath: "live-transcripts/a.md", state: "active" })
    expect(resolver.resolve({ kind: "workspace.open.path", target: "live-transcripts/a.md" })).toMatchObject({
      component: "live-transcription.markdown",
      score: 10_000,
    })
    expect(resolver.resolve({ kind: "workspace.open.path", target: "live-transcripts/b.md" })).toBeUndefined()
    expect(resolver.resolve({ kind: "workspace.open.path", target: "README.md" })).toBeUndefined()
  })

  it("locks the active exact path and unlocks after terminal state", () => {
    liveTranscriptBrowserState.set({ liveSessionId: "live-1", transcriptPath: "live-transcripts/a.md", state: "active" })
    const props = { params: { path: "live-transcripts/a.md" }, api: {} }
    const view = render(createElement(LiveTranscriptMarkdownPane, props as never))
    expect(screen.getByTestId("markdown")).toHaveAttribute("data-mode", "view")

    act(() => liveTranscriptBrowserState.set({ liveSessionId: "live-1", transcriptPath: "live-transcripts/a.md", state: "complete" }))
    expect(screen.getByTestId("markdown")).toHaveAttribute("data-mode", "edit")
    view.unmount()
  })
})
