import { createElement, useSyncExternalStore, type ComponentType, type ReactNode } from "react"
import { useComposerRecordingAdapter } from "@hachej/boring-agent/front"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@hachej/boring-workspace", () => ({
  MarkdownEditorPane: ({ params }: { params?: { path?: string; mode?: string } }) => (
    <div data-testid="markdown" data-path={params?.path} data-mode={params?.mode} />
  ),
  postUiCommand: vi.fn(),
}))

import { liveTranscriptBrowserState } from "../state"
import {
  LiveTranscriptComposerDock,
  LiveTranscriptMarkdownPane,
  liveTranscriptCommands,
  liveTranscriptController,
  liveTranscriptPlugin,
} from "../index"

describe("live transcript front surface", () => {
  beforeEach(() => liveTranscriptBrowserState.set({}))
  afterEach(() => vi.restoreAllMocks())

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

  it("parses exact live commands without forwarding them to Pi", async () => {
    const live = liveTranscriptCommands.find((command) => command.name === "live")!
    const start = vi.spyOn(liveTranscriptController, "start").mockResolvedValue("started")
    const stop = vi.spyOn(liveTranscriptController, "stop").mockResolvedValue("stopped")
    const status = vi.spyOn(liveTranscriptController, "status").mockResolvedValue("status")

    await expect(live.handler("start Weekly sync", { sessionId: "chat-a" } as never)).resolves.toBe("started")
    expect(start).toHaveBeenCalledWith("chat-a", "Weekly sync")
    await expect(live.handler("stop", { sessionId: "chat-b" } as never)).resolves.toBe("stopped")
    await expect(live.handler("status", { sessionId: "chat-b" } as never)).resolves.toBe("status")
    await expect(live.handler("restart", { sessionId: "chat-a" } as never)).resolves.toContain("Usage: /live")
    expect(stop).toHaveBeenCalledOnce()
    expect(status).toHaveBeenCalledOnce()
  })

  it("wins only for the exact active path", () => {
    const registrations: { panels: any[]; resolvers: any[]; bindings: any[]; providers: any[] } = { panels: [], resolvers: [], bindings: [], providers: [] }
    liveTranscriptPlugin({
      registerPanel: (value: unknown) => registrations.panels.push(value),
      registerSurfaceResolver: (value: unknown) => registrations.resolvers.push(value),
      registerBinding: (value: unknown) => registrations.bindings.push(value),
      registerProvider: (value: unknown) => registrations.providers.push(value),
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

  it("provides stable recording snapshots to React external-store consumers", () => {
    const providers: Array<{ component: ComponentType<{ children: ReactNode }> }> = []
    liveTranscriptPlugin({
      registerPanel: vi.fn(),
      registerSurfaceResolver: vi.fn(),
      registerBinding: vi.fn(),
      registerProvider: (value: unknown) => providers.push(value as { component: ComponentType<{ children: ReactNode }> }),
    } as never)
    const Provider = providers[0]!.component
    let renders = 0
    function Probe() {
      const adapter = useComposerRecordingAdapter()!
      const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot)
      renders += 1
      return <div data-testid="recording-phase">{snapshot.phase}</div>
    }

    const view = render(<Provider><Probe /></Provider>)
    expect(screen.getByTestId("recording-phase")).toHaveTextContent("idle")
    act(() => liveTranscriptBrowserState.set({ recordingKind: "short", phase: "recording", startedAt: 1 }))
    expect(screen.getByTestId("recording-phase")).toHaveTextContent("recording")
    expect(renders).toBeLessThan(5)
    view.unmount()
  })

  it("renders detached live controls with truthful current behavior and disabled concept controls", async () => {
    const clearInterval = vi.spyOn(window, "clearInterval")
    const review = vi.spyOn(liveTranscriptController, "review").mockResolvedValue("Transcript review requested.")
    let resolveStop!: () => void
    const stop = vi.spyOn(liveTranscriptController, "stopLiveRecording").mockImplementation(
      () => new Promise<void>((resolve) => { resolveStop = resolve }),
    )
    liveTranscriptBrowserState.set({
      liveSessionId: "live-1",
      transcriptPath: "live-transcripts/a.md",
      state: "active",
      recordingKind: "live",
      phase: "recording",
      startedAt: Date.now() - 15_000,
    })

    const view = render(<LiveTranscriptComposerDock />)
    expect(screen.getByText("Live transcript")).toBeVisible()
    expect(screen.getByText(/Next review check/)).toBeVisible()
    expect(screen.getByText("Every 60s")).toBeVisible()
    expect(screen.getByRole("progressbar", { name: "Time until next agent nudge" })).toHaveAttribute("aria-valuetext")
    expect(screen.queryByText("Nudge controls")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Agent nudge settings" }))
    expect(screen.getByText("Concept preview — scheduling controls are not active yet.")).toBeVisible()
    expect(screen.getByRole("switch", { name: "Proactive nudges" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Balanced" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Ping agent" }))
    await waitFor(() => expect(review).toHaveBeenCalledOnce())
    expect(await screen.findByRole("button", { name: "Sent" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(screen.getByRole("button", { name: "Finalizing…" })).toBeDisabled()
    expect(stop).toHaveBeenCalledOnce()
    await act(async () => resolveStop())
    view.unmount()
    expect(clearInterval).toHaveBeenCalled()
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
