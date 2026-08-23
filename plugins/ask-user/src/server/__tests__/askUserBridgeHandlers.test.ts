// @vitest-environment node

import Fastify, { type FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBrowserBridgeAuthPolicy,
  createWorkspaceBridgeRegistry,
  InMemoryWorkspaceBridgeIdempotencyStore,
  workspaceBridgeHttpRoutes,
  WorkspaceBridgeErrorCode,
  type WorkspaceBridgeCallContext,
} from "@hachej/boring-workspace/server"
import { createQuestionsClient } from "../../front/client"
import { ASK_USER_BRIDGE_CAPABILITIES, ASK_USER_BRIDGE_OPS } from "../../shared"
import { AskUserRuntime } from "../askUserRuntime"
import { createAskUserBridgeHandlers } from "../askUserBridgeHandlers"
import { MemoryAskUserStore } from "./testAskUserStore"

const schema = { wireVersion: 1 as const, fields: [{ type: "text" as const, name: "answer", label: "Answer", required: true }] }
const controllers: AbortController[] = []

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort()
  vi.unstubAllGlobals()
})

function runtimeContext(overrides: Partial<WorkspaceBridgeCallContext> = {}): WorkspaceBridgeCallContext {
  return {
    callerClass: "runtime",
    workspaceId: "workspace-1",
    sessionId: "s1",
    capabilities: [ASK_USER_BRIDGE_CAPABILITIES.request],
    actor: {
      actorKind: "agent",
      performedBy: { label: "agent-runtime" },
      onBehalfOf: { id: "user-1", label: "user:user-1" },
    },
    ...overrides,
  }
}

function browserContext(userId: string, capabilities: string[]): WorkspaceBridgeCallContext {
  return {
    callerClass: "browser",
    workspaceId: "workspace-1",
    sessionId: "s1",
    capabilities,
    actor: { actorKind: "human", performedBy: { id: userId, label: `user:${userId}` } },
  }
}

function fixture() {
  const store = new MemoryAskUserStore()
  const runtime = new AskUserRuntime({ store })
  const registry = createWorkspaceBridgeRegistry()
  for (const entry of createAskUserBridgeHandlers({ store, runtime })) {
    registry.registerHandler(entry.definition, entry.handler)
  }
  return { store, runtime, registry }
}

async function productionPolicyApp() {
  const { store, runtime, registry } = fixture()
  const app = Fastify()
  await app.register(workspaceBridgeHttpRoutes, {
    registry,
    ownerWorkspaceId: "workspace-1",
    idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
    browserAuthPolicy: createBrowserBridgeAuthPolicy({
      getPrincipal: () => ({ userId: "user-1" }),
      authorizeWorkspace: ({ workspaceId, definition }) => ({
        allowed: workspaceId === "workspace-1",
        capabilities: definition.requiredCapabilities,
      }),
      allowedOrigins: ["https://app.example.test"],
      requireCsrfHeader: true,
    }),
  })
  return { app, store, runtime }
}

function injectFetch(app: FastifyInstance) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "https://app.example.test")
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    headers.origin ??= "https://app.example.test"
    const response = await app.inject({
      method: (init?.method ?? "GET") as "GET" | "POST",
      url: `${url.pathname}${url.search}`,
      headers,
      payload: init?.body ? String(init.body) : undefined,
    })
    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers as Record<string, string>,
    })
  }
}

describe("plugin-owned ask-user WorkspaceBridge handlers", () => {
  it("keeps the real browser client compatible with the production bridge policy", async () => {
    const { app, runtime, store } = await productionPolicyApp()
    vi.stubGlobal("fetch", injectFetch(app))
    try {
      const awaitingAnswer = runtime.ask({
        sessionId: "s1",
        title: "Production policy question",
        schema,
        ownerPrincipalId: "user-1",
      })
      const question = await vi.waitFor(async () => {
        const pending = await store.getPending("s1")
        expect(pending).not.toBeNull()
        return pending!
      })

      const client = createQuestionsClient({ headers: { "x-boring-workspace-id": "workspace-1" } })
      await expect(client.pending("s1")).resolves.toMatchObject({ questionId: question.questionId })
      await expect(client.submit(question, { answer: "continue" })).resolves.toMatchObject({ status: "answered" })
      await expect(awaitingAnswer).resolves.toMatchObject({ status: "answered", answer: { values: { answer: "continue" } } })

      const missingCsrf = createQuestionsClient({
        headers: { "x-boring-workspace-id": "workspace-1", "x-csrf-token": "" },
      })
      await expect(missingCsrf.pending("s1")).rejects.toMatchObject({ statusCode: 401 })

      const wrongOrigin = createQuestionsClient({
        headers: { "x-boring-workspace-id": "workspace-1", origin: "https://evil.example.test" },
      })
      await expect(wrongOrigin.pending("s1")).rejects.toMatchObject({ statusCode: 401 })

      const wrongWorkspace = createQuestionsClient({ headers: { "x-boring-workspace-id": "workspace-2" } })
      await expect(wrongWorkspace.pending("s1")).rejects.toMatchObject({ statusCode: 403 })
    } finally {
      await app.close()
    }
  })

  it("handles request -> pending -> browser answer through ask-user.v1 ops", async () => {
    const { store, registry } = fixture()
    const controller = new AbortController()
    controllers.push(controller)
    const artifact = { id: "plan", surfaceKind: "workspace.open.path", target: "docs/plan.md", title: "Plan" }
    const request = registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s1", title: "Need input", schema, artifacts: [artifact], timeoutMs: 60_000 },
      requestId: "req-1",
    }, runtimeContext({ signal: controller.signal }))

    const question = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    }, { timeout: 10_000 })
    expect(question).toMatchObject({ title: "Need input", ownerPrincipalId: "user-1", status: "ready", artifacts: [artifact] })

    const pending = await registry.call({ op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: "s1" } }, browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.pending]))
    expect(pending).toMatchObject({ ok: true, output: { pending: { questionId: question.questionId, artifacts: [artifact] } } })

    const answer = await registry.call({
      op: ASK_USER_BRIDGE_OPS.answer,
      input: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "ok" } },
    }, browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.answer]))
    expect(answer).toMatchObject({ ok: true, output: { status: "answered" } })

    await expect(request).resolves.toMatchObject({
      ok: true,
      output: { status: "answered", answer: { values: { answer: "ok" } } },
    })
  })

  it("carries riskTier from a bridge-originated request onto the decision record (finding 6)", async () => {
    const { store, registry } = fixture()
    const controller = new AbortController()
    controllers.push(controller)
    const request = registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s1", title: "Risky", schema, timeoutMs: 60_000, riskTier: "consequential" },
      requestId: "req-risk",
    }, runtimeContext({ signal: controller.signal }))

    const question = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    }, { timeout: 10_000 })
    expect(question.riskTier).toBe("consequential")

    const answer = await registry.call({
      op: ASK_USER_BRIDGE_OPS.answer,
      input: { questionId: question.questionId, sessionId: "s1", answerToken: question.answerToken, values: { answer: "ok" } },
    }, browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.answer]))
    expect(answer).toMatchObject({ ok: true, output: { status: "answered" } })
    await request

    await expect(store.getDecisionRecord(question.questionId)).resolves.toMatchObject({ riskTier: "consequential" })
  })

  it("rejects a bridge request with an unknown riskTier", async () => {
    const { registry } = fixture()
    const rejected = await registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s1", title: "Bad tier", schema, riskTier: "not-a-real-tier" },
      requestId: "req-bad-risk",
    }, runtimeContext())
    expect(rejected).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.InvalidRequest } })
  })

  it("keeps pending questions scoped by session", async () => {
    const { store, registry } = fixture()
    const c1 = new AbortController()
    const c2 = new AbortController()
    controllers.push(c1, c2)
    const r1 = registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s1", title: "S1", schema, timeoutMs: 60_000 },
      requestId: "req-s1",
    }, runtimeContext({ sessionId: "s1", signal: c1.signal }))
    const r2 = registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s2", title: "S2", schema, timeoutMs: 60_000 },
      requestId: "req-s2",
    }, runtimeContext({ sessionId: "s2", signal: c2.signal }))

    const q1 = await vi.waitFor(async () => {
      const pending = await store.getPending("s1")
      expect(pending).not.toBeNull()
      return pending!
    }, { timeout: 10_000 })
    const q2 = await vi.waitFor(async () => {
      const pending = await store.getPending("s2")
      expect(pending).not.toBeNull()
      return pending!
    }, { timeout: 10_000 })
    expect(q1.questionId).not.toBe(q2.questionId)

    const p1 = await registry.call({ op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: "s1" } }, browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.pending]))
    const p2 = await registry.call({ op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: "s2" } }, { ...browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.pending]), sessionId: "s2" })
    expect(p1).toMatchObject({ ok: true, output: { pending: { questionId: q1.questionId } } })
    expect(p2).toMatchObject({ ok: true, output: { pending: { questionId: q2.questionId } } })

    const answer = await registry.call({
      op: ASK_USER_BRIDGE_OPS.answer,
      input: { questionId: q1.questionId, sessionId: "s1", answerToken: q1.answerToken, values: { answer: "ok" } },
    }, browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.answer]))
    expect(answer).toMatchObject({ ok: true, output: { status: "answered" } })
    await expect(r1).resolves.toMatchObject({ ok: true, output: { status: "answered" } })
    await expect(store.getPending("s2")).resolves.toMatchObject({ questionId: q2.questionId })
    c2.abort()
    await expect(r2).resolves.toMatchObject({ ok: true, output: { status: "cancelled" } })
  })

  it("denies runtime requests for a different session than the verified runtime context", async () => {
    const { registry } = fixture()
    const denied = await registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s2", title: "Wrong session", schema },
      requestId: "req-mismatch",
    }, runtimeContext())

    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })

  it("denies browser reads without a verified matching session", async () => {
    const { registry } = fixture()
    const denied = await registry.call(
      { op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: "s1" } },
      { ...browserContext("user-1", [ASK_USER_BRIDGE_CAPABILITIES.pending]), sessionId: undefined },
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })

  it("denies a browser principal reading another user's pending question", async () => {
    const { store, registry } = fixture()
    const controller = new AbortController()
    controllers.push(controller)
    void registry.call({
      op: ASK_USER_BRIDGE_OPS.request,
      input: { sessionId: "s1", title: "Need input", schema, timeoutMs: 60_000 },
      requestId: "req-2",
    }, runtimeContext({ signal: controller.signal }))

    await vi.waitFor(async () => {
      expect(await store.getPending("s1")).not.toBeNull()
    }, { timeout: 10_000 })

    const denied = await registry.call(
      { op: ASK_USER_BRIDGE_OPS.pending, input: { sessionId: "s1" } },
      browserContext("user-2", [ASK_USER_BRIDGE_CAPABILITIES.pending]),
    )
    expect(denied).toMatchObject({ ok: false, error: { code: WorkspaceBridgeErrorCode.ResourceScopeDenied } })
  })
})
