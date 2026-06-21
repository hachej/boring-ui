import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UI_COMMAND_EVENT, events, userMeta, workspaceEvents } from "@hachej/boring-workspace"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import type { AskUserQuestion } from "../../shared/types"
import { askUserPlugin } from "../index"

const capturedPlugin = captureFrontPlugin(askUserPlugin)

const question: AskUserQuestion = {
  questionId: "q1",
  sessionId: "default",
  ownerPrincipalId: "anonymous",
  status: "ready",
  title: "Choose A or B",
  context: "Pick one.",
  answerToken: "secret",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  schema: { wireVersion: 1, fields: [{ type: "radio", name: "choice", label: "Choose one", required: true, options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] }] },
}

const nextQuestion: AskUserQuestion = {
  ...question,
  questionId: "q2",
  title: "Choose again",
  answerToken: "secret-2",
}

function pendingStateFor(q: AskUserQuestion | null) {
  return {
    "questions.pending": q ? {
      hint: { questionId: q.questionId, sessionId: q.sessionId, status: q.status },
      hintsBySession: { [q.sessionId]: { questionId: q.questionId, sessionId: q.sessionId, status: q.status } },
    } : { hint: null, hintsBySession: {} },
  }
}

function pendingStateForMany(questions: AskUserQuestion[]) {
  return {
    "questions.pending": {
      hint: questions[0] ? { questionId: questions[0].questionId, sessionId: questions[0].sessionId, status: questions[0].status } : null,
      hintsBySession: Object.fromEntries(questions.map((q) => [q.sessionId, { questionId: q.questionId, sessionId: q.sessionId, status: q.status }])),
    },
  }
}

function getProvider() {
  return capturedPlugin.registrations.providers[0]!.component as any
}

function getPanel() {
  return capturedPlugin.registrations.panels[0]!.component as any
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("askUserPlugin front shell", () => {
  it("reads pending question, submits with token/session, and closes ephemeral pane", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "answered" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const close = vi.fn()
    const closeWorkbench = vi.fn()
    render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{ __closeWorkbenchOnDone: closeWorkbench }} api={{ close }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(screen.queryByText(/^Questions$/)).not.toBeInTheDocument()
    const choice = screen.getByRole("radio", { name: "A" })
    fireEvent.click(choice)
    fireEvent.change(choice, { target: { checked: true } })
    await waitFor(() => expect(screen.getByRole("button", { name: "Send answers" })).not.toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await waitFor(() => expect(close).toHaveBeenCalled())
    expect(closeWorkbench).toHaveBeenCalled()
    const submitCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.answer"))
    expect(JSON.parse(String(submitCall![1]!.body))).toMatchObject({
      op: "human-input.v1.answer",
      input: { questionId: "q1", sessionId: "default", answerToken: "secret", values: { choice: "A" } },
    })
  })

  it("rehydrates the same session pending question after provider remount", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        return Response.json({ ok: true, output: { pending: question } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()

    const first = render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)
    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    first.unmount()

    render(<Provider apiBaseUrl="" activeSessionId="default"><Panel params={{}} api={{ close: vi.fn() }} className="h-full" /></Provider>)
    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")).length).toBeGreaterThanOrEqual(2)
  })

  it("refreshes the pane when surface params retarget a newer question in the same session", async () => {
    const first = { ...question, questionId: "retarget-q1", sessionId: "retarget-session", title: "Retarget first" }
    const second = { ...nextQuestion, questionId: "retarget-q2", sessionId: "retarget-session", title: "Retarget second" }
    let current: AskUserQuestion | null = first
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        return Response.json({ ok: true, output: { pending: current } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    const view = render(<Provider apiBaseUrl="" activeSessionId="retarget-session"><Panel params={{ sessionId: "retarget-session", questionId: "retarget-q1" }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Retarget first")).toBeInTheDocument()

    current = second
    view.rerender(<Provider apiBaseUrl="" activeSessionId="retarget-session"><Panel params={{ sessionId: "retarget-session", questionId: "retarget-q2" }} api={api} className="h-full" /></Provider>)

    expect(await screen.findByText("Retarget second")).toBeInTheDocument()
    expect(screen.queryByText("Retarget first")).not.toBeInTheDocument()
  })

  it("invalidates a cached payload when the authoritative session hint advances", async () => {
    const staleQuestion = { ...question, questionId: "stale-q1", sessionId: "stale-session", title: "First stale question" }
    const staleNextQuestion = { ...nextQuestion, questionId: "stale-q2", sessionId: "stale-session", title: "Second stale question" }
    let current: AskUserQuestion | null = staleQuestion
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        return Response.json({ ok: true, output: { pending: current } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(current))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()

    render(<Provider apiBaseUrl="" activeSessionId="stale-session"><Panel params={{ sessionId: "stale-session" }} api={{ close: vi.fn() }} className="h-full" /></Provider>)
    expect(await screen.findByText("First stale question")).toBeInTheDocument()

    current = staleNextQuestion
    act(() => {
      events.emit(workspaceEvents.uiCommand, { ...userMeta(), command: { kind: "openSurface", params: { kind: "questions", target: "stale-q2", meta: { sessionId: "stale-session", openOnlyWhenSessionOpen: true } } } })
    })

    expect(await screen.findByText("Second stale question")).toBeInTheDocument()
    expect(screen.queryByText("First stale question")).not.toBeInTheDocument()
  })

  it("rehydrates question from human-input pending when opened from surface metadata", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        return Response.json({ ok: true, output: { pending: question } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const { container } = render(<Provider apiBaseUrl=""><Panel params={{ questionId: "q1", sessionId: "default" }} api={{ close: vi.fn() }} className="h-full" /></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass("overflow-hidden")
  })

  it("does not cancel pending questions when a session switch stops the previous composer", async () => {
    const s1Question = { ...question, questionId: "switch-q1", sessionId: "s1", title: "Question for s1" }
    const s2Question = { ...nextQuestion, questionId: "switch-q2", sessionId: "s2", title: "Question for s2" }
    const pendingBySession = new Map<string, AskUserQuestion>([["s1", s1Question], ["s2", s2Question]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    render(<Provider apiBaseUrl="" activeSessionId="s1" openSessionIds={["s1"]}><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending"))).toBe(true))

    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: "s1", reason: "session-switch" } }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(false)
  })

  it("does not auto-open Questions for a pending session that is not open in the app", async () => {
    const closedQuestion = { ...question, questionId: "closed-q1", sessionId: "closed-session", title: "Closed session question" }
    const commands: unknown[] = []
    const onCommand = (event: Event) => commands.push((event as CustomEvent).detail)
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) return Response.json({ ok: true, output: { pending: closedQuestion } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(closedQuestion))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    try {
      render(<Provider apiBaseUrl="" activeSessionId="closed-session" openSessionIds={["other-session"]}><div>child</div></Provider>)
      await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending"))).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(commands).not.toContainEqual(expect.objectContaining({ kind: "openSurface" }))
    } finally {
      window.removeEventListener(UI_COMMAND_EVENT, onCommand)
    }
  })

  it("composer stop cancels pending question even when pane is closed", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl="" activeSessionId="default"><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.pending"))).toBe(true))
    window.dispatchEvent(new CustomEvent("boring:workspace-composer-stop", { detail: { sessionId: "default" } }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("human-input.v1.cancel"))).toBe(true))
  })

  it("registers surface resolver and no-topbar panel output", () => {
    const panel = capturedPlugin.registrations.panels[0]!
    const resolver = capturedPlugin.registrations.surfaceResolvers[0]!
    expect(panel.id).toBe("ask-user.questions")
    expect(panel.chromeless).toBe(true)
    expect(resolver.resolve({ kind: "questions", target: "q1", meta: { sessionId: "default" } })).toMatchObject({ component: "ask-user.questions", id: "ask-user.questions", params: { questionId: "q1", sessionId: "default" } })
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(askUserPlugin.pluginId).toBe("ask-user")
    expect(askUserPlugin.pluginLabel).toBe("Questions")
  })
})
