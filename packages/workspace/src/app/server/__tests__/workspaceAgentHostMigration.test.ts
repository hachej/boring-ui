// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function workspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "boring-workspace-mig-ws-"))
  tempDirs.push(root)
  return root
}

function harnessFactory() {
  const sessions = new Map<string, { id: string; title: string; createdAt: string; updatedAt: string; turnCount: number }>()
  return async () => ({
    id: "mig-ws-test-harness",
    placement: "server" as const,
    sessions: {
      async list() { return [...sessions.values()] },
      async create(_ctx: unknown, init?: { title?: string }) {
        const id = `session-${sessions.size + 1}`
        const now = new Date().toISOString()
        const session = { id, title: init?.title ?? "Untitled", createdAt: now, updatedAt: now, turnCount: 0 }
        sessions.set(id, session)
        return session
      },
      async load(_ctx: unknown, sessionId: string) {
        const session = sessions.get(sessionId)
        if (!session) throw new Error("session not found")
        return { ...session, messages: [] }
      },
      async delete(_ctx: unknown, sessionId: string) { sessions.delete(sessionId) },
    },
    async *sendMessage() {},
  })
}

describe("Workspace AgentHost composition root", () => {
  test("serves an addressed fleet and addressed default-agent sessions", async () => {
    const root = await workspaceRoot()
    const app = await createWorkspaceAgentServer({
      workspaceRoot: root,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      harnessFactory: harnessFactory(),
      agents: [
        { agentTypeId: "alpha", definition: { label: "Alpha", instructions: "alpha instructions" } },
        { agentTypeId: "beta", definition: { label: "Beta", instructions: "beta instructions" } },
      ],
      defaultAgentTypeId: "alpha",
    })
    try {
      const headers = {
        "x-boring-workspace-id": basename(root),
        "x-boring-storage-scope": "default",
      }
      const catalog = await app.inject({ method: "GET", url: "/api/v1/agents", headers })
      expect(catalog.statusCode).toBe(200)
      expect(catalog.json()).toEqual([
        { agentTypeId: "alpha", label: "Alpha" },
        { agentTypeId: "beta", label: "Beta" },
      ])

      const sessions = await app.inject({ method: "GET", url: "/api/v1/agents/alpha/sessions", headers })
      expect(sessions.statusCode).toBe(200)
      expect(sessions.json()).toMatchObject({
        sessions: expect.arrayContaining([
          expect.objectContaining({ ref: { agentTypeId: "alpha", sessionId: expect.any(String) } }),
        ]),
      })
    } finally {
      await app.close()
    }
  })

  test("rejects foreign storage selectors before the Workspace scope issuer runs", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await workspaceRoot(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      harnessFactory: harnessFactory(),
    })
    try {
      const denied = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "foreign" },
      })
      expect(denied.statusCode).toBe(403)
      expect(denied.json()).toEqual({
        error: {
          code: "WORKSPACE_UNINITIALIZED",
          message: "workspace/storage selector is not allowed",
        },
      })

      const defaulted = await app.inject({ method: "GET", url: "/api/v1/agents" })
      expect(defaulted.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})
