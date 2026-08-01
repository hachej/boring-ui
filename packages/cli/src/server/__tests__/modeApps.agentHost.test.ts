import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as agentServer from "@hachej/boring-agent/server"
import type { AuthorizedAgentScope } from "@hachej/boring-agent/shared"
import { assertComposedAgentHostRouteTable } from "@hachej/boring-agent/server/agent-host/testing/compositionRouteProof"
import { PiSessionStore } from "../../../../agent/src/server/harness/pi-coding-agent/sessions.js"
import { createLocalWorkspaceRegistry } from "../localWorkspaces.js"
import { createFolderModeApp, createWorkspacesModeApp } from "../modeApps.js"

vi.mock("../pluginDiscovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pluginDiscovery.js")>()
  return {
    ...actual,
    resolveCliDefaultPluginPackagePaths: () => [],
    resolveCliBoringPluginDirs: () => [],
  }
})

const roots: string[] = []
const originalHome = process.env.HOME
const originalSessionRoot = process.env.BORING_AGENT_SESSION_ROOT

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function restoreEnv(name: "HOME" | "BORING_AGENT_SESSION_ROOT", value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(async () => {
  restoreEnv("HOME", originalHome)
  restoreEnv("BORING_AGENT_SESSION_ROOT", originalSessionRoot)
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixtureApp(useConfiguredSessionRoot: boolean) {
  const home = await temporaryRoot("boring-cli-agent-host-home-")
  const workspaceRoot = await temporaryRoot("boring-cli-agent-host-workspace-")
  const registryRoot = await temporaryRoot("boring-cli-agent-host-registry-")
  const configuredSessionRoot = useConfiguredSessionRoot
    ? await temporaryRoot("boring-cli-agent-host-sessions-")
    : undefined
  process.env.HOME = home
  restoreEnv("BORING_AGENT_SESSION_ROOT", configuredSessionRoot)

  const registryPath = join(registryRoot, "workspaces.yaml")
  const workspace = await createLocalWorkspaceRegistry(registryPath).add(workspaceRoot)
  const rollbackReader = new PiSessionStore(resolve(workspaceRoot))
  const created = await rollbackReader.create(
    { workspaceId: workspace.id, userId: "local" },
    { title: "pre-MIG-CLI fixture" },
  )
  const sessionId = created.id
  const transcriptPath = join(rollbackReader.getSessionDir(), `${sessionId}.jsonl`)
  const transcript = await readFile(transcriptPath, "utf8")
  const legacySessions = [
    { id: "native-unscoped", context: undefined },
    { id: "workspace-only", context: { workspaceId: workspace.id } },
    { id: "other-workspace", context: { workspaceId: "other", userId: "local" } },
    { id: "other-user", context: { workspaceId: workspace.id, userId: "other" } },
  ] as const
  await Promise.all(legacySessions.map(async ({ id, context }) => {
    await writeFile(
      join(rollbackReader.getSessionDir(), `${id}.jsonl`),
      `${JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-07-30T00:00:00.000Z",
        cwd: workspaceRoot,
        ...(context ? { boringSessionCtx: context } : {}),
      })}\n`,
      "utf8",
    )
  }))
  const compatibleSessionIds = [sessionId, "native-unscoped", "workspace-only"].sort()

  const createAgentHost = vi.spyOn(agentServer, "createAgentHost")
  const app = await createWorkspacesModeApp({
    mode: "direct",
    registryPath,
    provisionWorkspace: false,
  })
  return { app, workspace, sessionId, compatibleSessionIds, transcript, transcriptPath, createAgentHost, rollbackReader }
}

describe.sequential("CLI Agent Host composition", () => {
  it("Slice 4 composed route/auth proof: CLI folder mode inherits Workspace's direct Host projection", async () => {
    const workspaceRoot = await temporaryRoot("boring-cli-folder-agent-host-")
    const sessionRoot = await temporaryRoot("boring-cli-folder-agent-sessions-")
    restoreEnv("BORING_AGENT_SESSION_ROOT", sessionRoot)
    const createAgentHost = vi.spyOn(agentServer, "createAgentHost")
    const app = await createFolderModeApp({
      workspaceRoot,
      mode: "direct",
      provisionWorkspace: false,
    })
    try {
      assertComposedAgentHostRouteTable(app)
      expect(createAgentHost).toHaveBeenCalledOnce()
      expect(createAgentHost).toHaveBeenCalledWith(expect.objectContaining({
        resolveAuthorizedEnvironmentScope: expect.any(Function),
        resolveAuthorizedAgentRuntimeScope: expect.any(Function),
      }))
      expect(app.hasRoute({ method: "GET", url: "/api/v1/agents" })).toBe(true)
      expect(app.hasRoute({
        method: "GET",
        url: "/api/v1/agents/:agentTypeId/sessions/:sessionId/attachments/:messageId/:index",
      })).toBe(true)
      expect((await app.inject({ method: "GET", url: "/api/v1/agents" })).statusCode).toBe(200)
      expect((await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })).statusCode).toBe(404)
    } finally {
      await app.close()
    }
  }, 30_000)

  it.each([
    ["unset", false],
    ["set", true],
  ] as const)(
    "Slice 1 composed route/auth proof: CLI workspaces mode uses one Host and preserves transcript bytes with root %s",
    async (_label, useConfiguredSessionRoot) => {
      const fixture = await fixtureApp(useConfiguredSessionRoot)
      const headers = { "x-boring-workspace-id": fixture.workspace.id }
      try {
        expect(fixture.createAgentHost).toHaveBeenCalledTimes(1)
        assertComposedAgentHostRouteTable(fixture.app)
        expect(fixture.createAgentHost).toHaveBeenCalledWith(expect.objectContaining({
          agents: [{ agentTypeId: "default", legacyDefault: true }],
          hostId: "cli-trusted-local",
        }))
        const hostOptions = fixture.createAgentHost.mock.calls[0]?.[0]
        expect(hostOptions).toBeDefined()
        await expect(hostOptions!.scopeVerifier.verify(Object.freeze({
          workspaceScopeId: fixture.workspace.id,
          authSubjectId: "local",
        }) as AuthorizedAgentScope)).rejects.toThrow("not issued by this process")

        const addressed = await fixture.app.inject({ method: "GET", url: "/api/v1/agents", headers })
        expect(addressed.statusCode, addressed.body).toBe(200)
        expect(addressed.json()).toEqual([{ agentTypeId: "default", label: "Agent" }])
        expect(fixture.app.hasRoute({
          method: "POST",
          url: "/api/v1/agents/:agentTypeId/reload",
        })).toBe(true)

        const legacyCatalog = await fixture.app.inject({ method: "GET", url: "/api/v1/agent/catalog", headers })
        expect(legacyCatalog.statusCode).toBe(200)

        const addressedSessions = await fixture.app.inject({
          method: "GET",
          url: "/api/v1/agents/default/sessions",
          headers,
        })
        expect(addressedSessions.statusCode).toBe(200)
        expect(addressedSessions.json().sessions
          .map((session: { ref: { sessionId: string } }) => session.ref.sessionId)
          .sort()).toEqual(fixture.compatibleSessionIds)

        const state = await fixture.app.inject({
          method: "GET",
          url: `/api/v1/agents/default/sessions/${fixture.sessionId}/state`,
          headers,
        })
        expect(state.statusCode).toBe(200)
        expect(state.json()).toMatchObject({
          ref: { agentTypeId: "default", sessionId: fixture.sessionId },
          state: { sessionId: fixture.sessionId, status: "idle" },
        })
        expect(await readFile(fixture.transcriptPath, "utf8")).toBe(fixture.transcript)

        const unknownWorkspace = await fixture.app.inject({
          method: "GET",
          url: "/api/v1/agents",
          headers: { "x-boring-workspace-id": "not-registered" },
        })
        expect(unknownWorkspace.statusCode).toBe(404)
      } finally {
        await fixture.app.close()
      }

      // The old reader after rollback sees the exact original path and bytes;
      // no migration, copy, repair, journal, or second writer was introduced.
      expect(await readFile(fixture.transcriptPath, "utf8")).toBe(fixture.transcript)
      expect((await fixture.rollbackReader.list({ workspaceId: fixture.workspace.id, userId: "local" })).map((row) => row.id))
        .toContain(fixture.sessionId)
      expect(fixture.createAgentHost).toHaveBeenCalledTimes(1)
    },
    30_000,
  )
})
