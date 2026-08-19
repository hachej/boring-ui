import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HumanArtifactListSchema, UI_COMMAND_EVENT, WORKSPACE_ATTENTION_ACTION_EVENT, WORKSPACE_COMPOSER_STOP_EVENT, WORKSPACE_COMPOSER_STOP_REASONS, WorkspaceProvider, events, userMeta, useWorkspaceAttention, workspaceEvents } from "@hachej/boring-workspace"
import { ArtifactOpenProvider } from "@hachej/boring-agent/front"
import { captureFrontPlugin } from "@hachej/boring-workspace/plugin"
import { AskUserToolInputSchema } from "../../shared/schema"
import type { AskUserQuestion } from "../../shared/types"
import { askUserPlugin } from "../index"
import { sharedQuestionsStore } from "../runtime"

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
  artifacts: [],
  schema: { wireVersion: 1, fields: [{ type: "radio", name: "choice", label: "Choose one", required: true, options: [{ value: "A", label: "A" }, { value: "B", label: "B" }] }] },
  toolCallId: "call-q1",
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
  const Provider = capturedPlugin.registrations.providers[0]!.component as any
  return function TestProvider(props: any) {
    return <Provider {...props} agentTypeId="alpha" />
  }
}

function getPanel() {
  return capturedPlugin.registrations.panels[0]!.component as any
}

afterEach(() => {
  sharedQuestionsStore.setPending(null)
  vi.unstubAllGlobals()
})

describe("askUserPlugin front shell", () => {
  it("reads pending question, submits with token/session, and closes ephemeral pane", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
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
    expect(closeWorkbench).toHaveBeenCalledTimes(1)
    const submitCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.answer"))
    expect(JSON.parse(String(submitCall![1]!.body))).toMatchObject({
      op: "ask-user.v1.answer",
      input: { questionId: "q1", sessionId: "default", answerToken: "secret", values: { choice: "A" } },
    })
  })

  it("rehydrates the same session pending question after provider remount", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
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
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")).length).toBeGreaterThanOrEqual(2)
  })

  it("does not carry a colliding session question across Workspace identities", async () => {
    let currentQuestion: AskUserQuestion | null = question
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        return Response.json({ ok: true, output: { pending: currentQuestion } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(currentQuestion))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const panel = <Panel params={{}} api={{ close: vi.fn() }} className="h-full" />
    const view = render(
      <WorkspaceProvider agentTypeId="alpha" apiBaseUrl="" plugins={[]} workspaceId="workspace-a">
        <Provider apiBaseUrl="" activeSessionId="default">{panel}</Provider>
      </WorkspaceProvider>,
    )
    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()

    currentQuestion = null
    view.rerender(
      <WorkspaceProvider agentTypeId="alpha" apiBaseUrl="" plugins={[]} workspaceId="workspace-b">
        <Provider apiBaseUrl="" activeSessionId="default">{panel}</Provider>
      </WorkspaceProvider>,
    )

    await waitFor(() => expect(screen.queryByText("Choose A or B")).not.toBeInTheDocument())
    expect(await screen.findByText("No pending questions")).toBeInTheDocument()
  })

  it("hydrates and shows a blocking hidden-session question on a fresh active session", async () => {
    const blockedQuestion = { ...question, questionId: "fresh-hidden-q1", sessionId: "blocked-session", title: "Question from blocked session", answerToken: "fresh-hidden-token-1" }
    const pendingBySession = new Map<string, AskUserQuestion>([[blockedQuestion.sessionId, blockedQuestion]])
    const requestedPendingSessions: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        const sessionId = body.input?.sessionId ?? ""
        requestedPendingSessions.push(sessionId)
        return Response.json({ ok: true, output: { pending: pendingBySession.get(sessionId) ?? null } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    render(<Provider apiBaseUrl="" activeSessionId="fresh-session" openSessionIds={["fresh-session"]}><Panel params={{ sessionId: blockedQuestion.sessionId, questionId: blockedQuestion.questionId }} api={api} className="h-full" /></Provider>)

    expect(await screen.findByText("Question from blocked session")).toBeInTheDocument()
    expect(screen.queryByText("No pending questions")).not.toBeInTheDocument()
    expect(requestedPendingSessions).toContain(blockedQuestion.sessionId)
    expect(api.close).not.toHaveBeenCalled()
  })

  it("keeps a hidden-session pending question visible when it is still blocking", async () => {
    const s1Question = { ...question, questionId: "hidden-pane-q1", sessionId: "hidden-pane-s1", title: "Question for hidden session", answerToken: "hidden-pane-token-1" }
    const pendingBySession = new Map<string, AskUserQuestion>([[s1Question.sessionId, s1Question]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    const view = render(<Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId, "other-open-session"]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question for hidden session")).toBeInTheDocument()

    view.rerender(<Provider apiBaseUrl="" activeSessionId="other-open-session" openSessionIds={["other-open-session"]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)

    expect(await screen.findByText("Question for hidden session")).toBeInTheDocument()
    expect(api.close).not.toHaveBeenCalled()
  })

  it("keeps an explicit hidden-session target instead of retargeting to the active session", async () => {
    const hiddenQuestion = { ...question, questionId: "multi-hide-q1", sessionId: "multi-hide-s1", title: "Hidden session question", answerToken: "multi-hide-token-1" }
    const visibleQuestion = { ...nextQuestion, questionId: "multi-hide-q2", sessionId: "multi-hide-s2", title: "Visible session question", answerToken: "multi-hide-token-2" }
    const pendingBySession = new Map<string, AskUserQuestion>([[hiddenQuestion.sessionId, hiddenQuestion], [visibleQuestion.sessionId, visibleQuestion]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    const view = render(<Provider apiBaseUrl="" activeSessionId={hiddenQuestion.sessionId} openSessionIds={[hiddenQuestion.sessionId, visibleQuestion.sessionId]}><Panel params={{ sessionId: hiddenQuestion.sessionId, questionId: hiddenQuestion.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Hidden session question")).toBeInTheDocument()

    view.rerender(<Provider apiBaseUrl="" activeSessionId={visibleQuestion.sessionId} openSessionIds={[visibleQuestion.sessionId]}><Panel params={{ sessionId: hiddenQuestion.sessionId, questionId: hiddenQuestion.questionId }} api={api} className="h-full" /></Provider>)

    expect(await screen.findByText("Hidden session question")).toBeInTheDocument()
    expect(screen.queryByText("Visible session question")).not.toBeInTheDocument()
    expect(api.close).not.toHaveBeenCalled()
  })

  it("switches the Questions pane between independently pending active sessions", async () => {
    const s1Question = { ...question, questionId: "multi-switch-q1", sessionId: "multi-switch-s1", title: "Question for session one", answerToken: "multi-token-1" }
    const s2Question = { ...nextQuestion, questionId: "multi-switch-q2", sessionId: "multi-switch-s2", title: "Question for session two", answerToken: "multi-token-2" }
    const pendingBySession = new Map<string, AskUserQuestion>([[s1Question.sessionId, s1Question], [s2Question.sessionId, s2Question]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    const view = render(<Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question for session one")).toBeInTheDocument()

    view.rerender(<Provider apiBaseUrl="" activeSessionId={s2Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question for session one")).toBeInTheDocument()
    expect(screen.queryByText("Question for session two")).not.toBeInTheDocument()

    view.rerender(<Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question for session one")).toBeInTheDocument()
    expect(screen.queryByText("Question for session two")).not.toBeInTheDocument()
  })

  it("keeps an exact Question artifact pinned to its requested session", async () => {
    const s1Question = { ...question, questionId: "exact-q1", sessionId: "exact-s1", title: "Active session question", answerToken: "exact-token-1" }
    const s2Question = { ...nextQuestion, questionId: "exact-q2", sessionId: "exact-s2", title: "Clicked artifact question", answerToken: "exact-token-2" }
    const pendingBySession = new Map<string, AskUserQuestion>([[s1Question.sessionId, s1Question], [s2Question.sessionId, s2Question]])
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    }))
    const Provider = getProvider()
    const Panel = getPanel()
    render(
      <Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}>
        <Panel params={{ sessionId: s2Question.sessionId, questionId: s2Question.questionId }} api={{ close: vi.fn() }} className="h-full" />
      </Provider>,
    )
    expect(await screen.findByText("Clicked artifact question")).toBeInTheDocument()
    expect(screen.queryByText("Active session question")).not.toBeInTheDocument()
  })

  it("answering one pending session leaves the other session question available", async () => {
    const s1Question = { ...question, questionId: "multi-answer-q1", sessionId: "multi-answer-s1", title: "Question remains", answerToken: "multi-answer-token-1" }
    const s2Question = { ...nextQuestion, questionId: "multi-answer-q2", sessionId: "multi-answer-s2", title: "Question to answer", answerToken: "multi-answer-token-2" }
    const pendingBySession = new Map<string, AskUserQuestion>([[s1Question.sessionId, s1Question], [s2Question.sessionId, s2Question]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.answer")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        if (body.input?.sessionId) pendingBySession.delete(body.input.sessionId)
        return Response.json({ ok: true, output: { ok: true, status: "answered" } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const Panel = getPanel()
    const api = { close: vi.fn() }

    const view = render(<Provider apiBaseUrl="" activeSessionId={s2Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}><Panel params={{ sessionId: s2Question.sessionId, questionId: s2Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question to answer")).toBeInTheDocument()
    const choice = screen.getByRole("radio", { name: "A" })
    fireEvent.click(choice)
    fireEvent.change(choice, { target: { checked: true } })
    await waitFor(() => expect(screen.getByRole("button", { name: "Send answers" })).not.toBeDisabled())
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }))

    await waitFor(() => expect(api.close).toHaveBeenCalled())
    expect(pendingBySession.has(s2Question.sessionId)).toBe(false)
    expect(pendingBySession.has(s1Question.sessionId)).toBe(true)

    view.rerender(<Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId]}><Panel params={{ sessionId: s1Question.sessionId, questionId: s1Question.questionId }} api={api} className="h-full" /></Provider>)
    expect(await screen.findByText("Question remains")).toBeInTheDocument()
    expect(screen.queryByText("Question to answer")).not.toBeInTheDocument()
  })

  it("refreshes the pane when surface params retarget a newer question in the same session", async () => {
    const first = { ...question, questionId: "retarget-q1", sessionId: "retarget-session", title: "Retarget first" }
    const second = { ...nextQuestion, questionId: "retarget-q2", sessionId: "retarget-session", title: "Retarget second" }
    let current: AskUserQuestion | null = first
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
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
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
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

  it("rehydrates question from ask-user pending when opened from surface metadata", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
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
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
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
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending"))).toBe(true))

    window.dispatchEvent(new CustomEvent(WORKSPACE_COMPOSER_STOP_EVENT, { detail: { sessionId: "s1", reason: WORKSPACE_COMPOSER_STOP_REASONS.sessionSwitch } }))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.cancel"))).toBe(false)
  })

  it("hydrates open non-active pending sessions so their composer stop can cancel", async () => {
    const s1Question = { ...question, questionId: "open-cancel-q1", sessionId: "open-cancel-s1", title: "Active open question", answerToken: "open-cancel-token-1" }
    const s2Question = { ...nextQuestion, questionId: "open-cancel-q2", sessionId: "open-cancel-s2", title: "Inactive open question", answerToken: "open-cancel-token-2" }
    const pendingBySession = new Map<string, AskUserQuestion>([[s1Question.sessionId, s1Question], [s2Question.sessionId, s2Question]])
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        return Response.json({ ok: true, output: { pending: pendingBySession.get(body.input?.sessionId ?? "") ?? null } })
      }
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.cancel")) {
        const body = JSON.parse(String(init?.body)) as { input?: { sessionId?: string } }
        if (body.input?.sessionId) pendingBySession.delete(body.input.sessionId)
        return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      }
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateForMany([...pendingBySession.values()]))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    render(<Provider apiBaseUrl="" activeSessionId={s1Question.sessionId} openSessionIds={[s1Question.sessionId, s2Question.sessionId]}><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending") && String(init?.body).includes(s2Question.sessionId))).toBe(true))

    window.dispatchEvent(new CustomEvent(WORKSPACE_COMPOSER_STOP_EVENT, { detail: { sessionId: s2Question.sessionId, reason: WORKSPACE_COMPOSER_STOP_REASONS.userStop } }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.cancel") && String(init?.body).includes(s2Question.sessionId))).toBe(true))
    expect(pendingBySession.has(s1Question.sessionId)).toBe(true)
    expect(pendingBySession.has(s2Question.sessionId)).toBe(false)
  })

  it("does not auto-open Questions when a pending session becomes visible", async () => {
    const pendingQuestion = { ...question, questionId: "visible-q1", sessionId: "visible-s1", title: "Answer from Inbox", answerToken: "visible-token-1" }
    const commands: unknown[] = []
    const onCommand = (event: Event) => commands.push((event as CustomEvent).detail)
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: pendingQuestion } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(pendingQuestion))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    try {
      render(<Provider apiBaseUrl="" activeSessionId={pendingQuestion.sessionId} openSessionIds={[pendingQuestion.sessionId]}><div>child</div></Provider>)
      await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending"))).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(commands).not.toContainEqual(expect.objectContaining({ kind: "openSurface" }))
    } finally {
      window.removeEventListener(UI_COMMAND_EVENT, onCommand)
    }
  })

  it("does not auto-open Questions for a pending session that is not open in the app", async () => {
    const closedQuestion = { ...question, questionId: "closed-q1", sessionId: "closed-session", title: "Closed session question" }
    const commands: unknown[] = []
    const onCommand = (event: Event) => commands.push((event as CustomEvent).detail)
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: closedQuestion } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(closedQuestion))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    try {
      render(<Provider apiBaseUrl="" activeSessionId="closed-session" openSessionIds={["other-session"]}><div>child</div></Provider>)
      await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending"))).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(commands).not.toContainEqual(expect.objectContaining({ kind: "openSurface" }))
    } finally {
      window.removeEventListener(UI_COMMAND_EVENT, onCommand)
    }
  })

  it("hydrates never-opened session questions from the durable list before reconciling SSE changes", async () => {
    const neverOpened = { ...question, questionId: "headless-q1", sessionId: "headless-session", title: "Headless worker approval", answerToken: "headless-token" }
    const later = { ...nextQuestion, questionId: "headless-q2", sessionId: "another-headless-session", title: "Later headless approval", answerToken: "later-token" }
    let readyQuestions = [question, neverOpened]
    const seen: Array<{ id: string; label: string }> = []
    function AttentionProbe() {
      const { blockers } = useWorkspaceAttention()
      seen.splice(0, seen.length, ...blockers.map(({ id, label }) => ({ id, label: label ?? "" })))
      return null
    }
    class FakeEventSource {
      static instance: FakeEventSource | null = null
      private readonly listeners = new Map<string, Set<EventListener>>()
      constructor(public readonly url: string) {
        if (url.includes("/api/v1/questions/events")) FakeEventSource.instance = this
      }
      addEventListener(type: string, listener: EventListener) {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>()
        listeners.add(listener)
        this.listeners.set(type, listeners)
      }
      removeEventListener(type: string, listener: EventListener) { this.listeners.get(type)?.delete(listener) }
      emit(type: string) { for (const listener of this.listeners.get(type) ?? []) listener(new Event(type)) }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/v1/questions?status=ready")) return Response.json({ questions: readyQuestions })
      return Response.json({})
    }))
    const Provider = getProvider()

    render(
      <WorkspaceProvider agentTypeId="alpha" apiBaseUrl="" plugins={[]} workspaceId="test-workspace">
        <Provider apiBaseUrl="" activeSessionId="default" openSessionIds={["default"]}>
          <AttentionProbe />
        </Provider>
      </WorkspaceProvider>,
    )

    await waitFor(() => expect(seen).toEqual(expect.arrayContaining([
      { id: "ask-user:default:q1", label: "Choose A or B" },
      { id: "ask-user:headless-session:headless-q1", label: "Headless worker approval" },
    ])))
    expect(seen).toHaveLength(2)
    expect(FakeEventSource.instance?.url).toBe("/api/v1/questions/events")

    readyQuestions = [neverOpened, later]
    act(() => FakeEventSource.instance?.emit("questions-changed"))
    await waitFor(() => expect(seen).toEqual(expect.arrayContaining([
      { id: "ask-user:headless-session:headless-q1", label: "Headless worker approval" },
      { id: "ask-user:another-headless-session:headless-q2", label: "Later headless approval" },
    ])))
    expect(seen).toHaveLength(2)
    expect(seen).not.toContainEqual(expect.objectContaining({ id: "ask-user:default:q1" }))
  })

  it("contributes pending questions as explicit inbox attention blockers", async () => {
    const seen: unknown[] = []
    function AttentionProbe() {
      const { blockers } = useWorkspaceAttention()
      seen.splice(0, seen.length, ...blockers)
      return null
    }
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(question))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()

    render(
      <WorkspaceProvider agentTypeId="alpha" apiBaseUrl="" plugins={[]} workspaceId="test-workspace">
        <Provider apiBaseUrl="" activeSessionId="default" openSessionIds={["default"]}>
          <AttentionProbe />
        </Provider>
      </WorkspaceProvider>,
    )

    await waitFor(() => expect(seen).toContainEqual(expect.objectContaining({
      id: "ask-user:default:q1",
      label: "Choose A or B",
      inbox: expect.objectContaining({ kind: "question", sourceLabel: "question", priority: 10 }),
      sessionBadge: expect.objectContaining({ kind: "question" }),
      composer: { visible: false },
      agentTypeId: "alpha",
    })))
  })

  it("generic attention cancel action cancels the matching ask-user question", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(question))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl="" activeSessionId="default"><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending"))).toBe(true))

    window.dispatchEvent(new CustomEvent(WORKSPACE_ATTENTION_ACTION_EVENT, {
      detail: {
        blockerId: "ask-user:default:q1",
        actionId: "cancel",
        sessionId: "default",
        blocker: { id: "ask-user:default:q1", reason: "ask-user.question", sessionId: "default", target: "q1" },
      },
    }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.cancel"))).toBe(true))
  })

  it("composer stop cancels pending question even when pane is closed", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/workspace-bridge/call")) return Response.json({ ok: true, output: { ok: true, status: "cancelled" } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json({})
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    render(<Provider apiBaseUrl="" activeSessionId="default"><div>child</div></Provider>)
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending"))).toBe(true))
    window.dispatchEvent(new CustomEvent(WORKSPACE_COMPOSER_STOP_EVENT, { detail: { sessionId: "default", reason: WORKSPACE_COMPOSER_STOP_REASONS.userStop } }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.cancel"))).toBe(true))
  })

  it("registers surface resolver and no-topbar panel output", () => {
    const panel = capturedPlugin.registrations.panels[0]!
    const resolver = capturedPlugin.registrations.surfaceResolvers[0]!
    expect(panel.id).toBe("ask-user.questions")
    expect(panel.chromeless).toBe(true)
    expect(resolver.resolve({ kind: "questions", target: "q1", meta: { sessionId: "default" } })).toMatchObject({ component: "ask-user.questions", id: "ask-user.questions", params: { questionId: "q1", sessionId: "default" } })
  })

  it("renders only the pending question that matches an inline tool call", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: question } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(question))
      return Response.json({})
    })
    vi.stubGlobal("fetch", fetchMock)
    const Provider = getProvider()
    const renderer = capturedPlugin.registrations.toolRenderers.find((registration) => registration.id === "ask_user")!
    const { rerender } = render(<Provider apiBaseUrl="" activeSessionId="other"><>{renderer.render({ toolCallId: question.toolCallId })}</></Provider>)

    expect(await screen.findByText("Choose A or B")).toBeInTheDocument()
    expect(screen.getByTestId("ask-user-inline-question")).toBeInTheDocument()
    const onCommand = vi.fn()
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    fireEvent.click(screen.getByRole("button", { name: "Open Questions" }))
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({
      kind: "openSurface",
      params: { kind: "questions", target: question.questionId, meta: { sessionId: question.sessionId } },
    }) }))
    window.removeEventListener(UI_COMMAND_EVENT, onCommand)

    rerender(<Provider apiBaseUrl="" activeSessionId="other"><>{renderer.render({ toolCallId: "another-call" })}</></Provider>)
    expect(screen.queryByTestId("ask-user-inline-question")).not.toBeInTheDocument()
  })

  it("renders the authored artifact list while pending and after resolution, with host-specific routing", async () => {
    const artifacts = [
      { id: "review", surfaceKind: "workspace.open.path", target: "docs/review.html", title: "PR review", description: "Inspect the exact visual diff." },
      { id: "catalog", surfaceKind: "catalog.open-row", target: "orders_daily", title: "Orders table", description: "Open the registered catalog surface." },
    ]
    const pendingQuestion = { ...question, artifacts }
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/workspace-bridge/call") && String(init?.body).includes("ask-user.v1.pending")) return Response.json({ ok: true, output: { pending: pendingQuestion } })
      if (String(url).endsWith("/api/v1/ui/state")) return Response.json(pendingStateFor(pendingQuestion))
      return Response.json({})
    }))
    const Provider = getProvider()
    const renderer = capturedPlugin.registrations.toolRenderers.find((registration) => registration.id === "ask_user")!
    const onOpenArtifact = vi.fn()
    const onCommand = vi.fn()
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    const input = { title: pendingQuestion.title, schema: pendingQuestion.schema, artifacts }
    const view = render(
      <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
        <Provider apiBaseUrl="" activeSessionId="default"><>{renderer.render({ toolCallId: pendingQuestion.toolCallId, state: "input-available", input })}</></Provider>
      </ArtifactOpenProvider>,
    )

    expect(await screen.findByText("PR review")).toBeInTheDocument()
    expect(screen.getByText("Inspect the exact visual diff.")).toBeInTheDocument()
    expect(screen.getByText("Orders table")).toBeInTheDocument()
    expect(screen.getByText("Open the registered catalog surface.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open PR review" }))
    expect(onOpenArtifact).toHaveBeenCalledWith("docs/review.html")
    expect(onCommand).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Open Orders table" }))
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({ detail: {
      kind: "openSurface",
      params: { kind: "catalog.open-row", target: "orders_daily" },
    } }))

    sharedQuestionsStore.setPending(null, pendingQuestion.sessionId)
    view.rerender(
      <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
        <Provider apiBaseUrl="" activeSessionId="default"><>{renderer.render({ toolCallId: "resolved-call", state: "output-available", input })}</></Provider>
      </ArtifactOpenProvider>,
    )
    expect(screen.getByText("Answer submitted")).toBeInTheDocument()
    expect(screen.getByText("PR review")).toBeInTheDocument()
    expect(screen.getByText("Orders table")).toBeInTheDocument()
    window.removeEventListener(UI_COMMAND_EVENT, onCommand)
  })

  it("keeps authored artifacts visible in cancelled output", () => {
    const Provider = getProvider()
    const renderer = capturedPlugin.registrations.toolRenderers.find((registration) => registration.id === "ask_user")!
    const onCommand = vi.fn()
    window.addEventListener(UI_COMMAND_EVENT, onCommand)
    render(<Provider apiBaseUrl=""><>{renderer.render({ state: "aborted", input: { title: "Review decision", schema: question.schema, artifacts: [{ id: "proof", surfaceKind: "workspace.open.path", target: "proof.md", title: "Proof bundle" }] } })}</></Provider>)
    expect(screen.getByText("Question cancelled")).toBeInTheDocument()
    expect(screen.getByText("Proof bundle")).toBeInTheDocument()
    const open = screen.getByRole("button", { name: "Open Proof bundle" })
    expect(open).toBeDisabled()
    fireEvent.click(open)
    expect(onCommand).not.toHaveBeenCalled()
    window.removeEventListener(UI_COMMAND_EVENT, onCommand)
  })

  it("fails closed for an invalid artifact payload without crashing the resolved card", () => {
    const Provider = getProvider()
    const renderer = capturedPlugin.registrations.toolRenderers.find((registration) => registration.id === "ask_user")!
    render(<Provider apiBaseUrl=""><>{renderer.render({ state: "output-available", input: { title: "Safe resolution", schema: question.schema, artifacts: [{ id: "duplicate", surfaceKind: "workspace.open.path", target: "one.md", title: "Must not render" }, { id: "duplicate", surfaceKind: "workspace.open.path", target: "two.md", title: "Also hidden" }] } })}</></Provider>)
    expect(screen.getByText("Safe resolution")).toBeInTheDocument()
    expect(screen.getByText("Answer submitted")).toBeInTheDocument()
    expect(screen.queryByText("Must not render")).not.toBeInTheDocument()
    expect(screen.queryByText("Also hidden")).not.toBeInTheDocument()
  })

  it("hides otherwise valid artifacts when the canonical ask_user input is malformed", () => {
    const Provider = getProvider()
    const renderer = capturedPlugin.registrations.toolRenderers.find((registration) => registration.id === "ask_user")!
    render(<Provider apiBaseUrl=""><>{renderer.render({ state: "output-error", input: { title: "Missing required schema", artifacts: [{ id: "proof", surfaceKind: "catalog.open-row", target: "orders", title: "Must stay hidden" }] } })}</></Provider>)
    expect(screen.getByText("Question cancelled")).toBeInTheDocument()
    expect(screen.queryByText("Must stay hidden")).not.toBeInTheDocument()
  })

  it("accepts the same authored artifact array in ask_user input and the shared Inbox schema", () => {
    const artifacts = [{ id: "review", surfaceKind: "workspace.open.path", target: "review.html", title: "Review", description: "Owner-facing review" }]
    const input = { title: "Approve?", schema: question.schema, artifacts }
    const toolResult = AskUserToolInputSchema.parse(input)
    const inboxResult = HumanArtifactListSchema.parse(input.artifacts)
    expect(toolResult.artifacts).toEqual(inboxResult)
    expect(toolResult.artifacts).toEqual(artifacts)
  })

  it("registers ask_user as an inline tool renderer", () => {
    expect(capturedPlugin.registrations.toolRenderers).toContainEqual(expect.objectContaining({ id: "ask_user", presentation: "inline" }))
  })

  it("carries pluginId + pluginLabel metadata (definePlugin contract)", () => {
    expect(askUserPlugin.pluginId).toBe("ask-user")
    expect(askUserPlugin.pluginLabel).toBe("Questions")
  })
})
