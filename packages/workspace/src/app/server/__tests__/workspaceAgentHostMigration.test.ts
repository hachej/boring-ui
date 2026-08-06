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

      const created = await app.inject({
        method: "POST",
        url: "/api/v1/agents/alpha/sessions",
        headers,
        payload: { title: "Alpha session" },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json()).toEqual({ agentTypeId: "alpha", sessionId: expect.any(String) })
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

  // Owner smoke found the fleet agent selector unusable: WorkspaceAgentFront.tsx
  // sends x-boring-storage-scope as `${workspaceScopeId}:${agentTypeId}` per
  // agent (gh-1106 multi-agent selector), but the exact-match allowlist check
  // 403'd every compound value. Only the portion before the first `:` is the
  // real workspace/storage selector — the suffix is client-side namespacing,
  // not a security boundary — so a crafted `<foreign>:<anything>` must still
  // be denied on the (unchanged) prefix check.
  test("accepts agent-namespaced storage scopes, still rejects a foreign prefix", async () => {
    const app = await createWorkspaceAgentServer({
      workspaceRoot: await workspaceRoot(),
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      harnessFactory: harnessFactory(),
    })
    try {
      const bare = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "default" },
      })
      expect(bare.statusCode).toBe(200)

      const compound = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "default:boring-worker" },
      })
      expect(compound.statusCode).toBe(200)

      const trailingColon = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "default:" },
      })
      expect(trailingColon.statusCode).toBe(200)

      // The security-relevant prefix is still exact-match: a crafted value
      // must not smuggle a foreign selector through, whether bare or with a
      // trailing agent-type suffix that happens to look legitimate.
      const foreignBare = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "other" },
      })
      expect(foreignBare.statusCode).toBe(403)

      const foreignCompound = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        headers: { "x-boring-storage-scope": "other:anything" },
      })
      expect(foreignCompound.statusCode).toBe(403)
      expect(foreignCompound.json()).toEqual({
        error: {
          code: "WORKSPACE_UNINITIALIZED",
          message: "workspace/storage selector is not allowed",
        },
      })

      const foreignPrefixOfAllowed = await app.inject({
        method: "GET",
        url: "/api/v1/agents",
        // "default" is allowed, but "evil:default" must not accidentally
        // resolve to an allowed prefix.
        headers: { "x-boring-storage-scope": "evil:default" },
      })
      expect(foreignPrefixOfAllowed.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })
})
