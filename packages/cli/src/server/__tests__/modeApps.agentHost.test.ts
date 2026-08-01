import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as agentServer from "@hachej/boring-agent/server"
import type { AuthorizedAgentScope } from "@hachej/boring-agent/shared"
import { PiSessionStore } from "../../../../agent/src/server/harness/pi-coding-agent/sessions.js"
import { createLocalWorkspaceRegistry } from "../localWorkspaces.js"
import { createWorkspacesModeApp } from "../modeApps.js"

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
  const nativeTranscriptName = (await readdir(rollbackReader.getSessionDir()))
    .find((name) => name.endsWith(`_${sessionId}.jsonl`))
  if (!nativeTranscriptName) throw new Error(`missing native transcript for ${sessionId}`)
  const transcriptPath = join(rollbackReader.getSessionDir(), nativeTranscriptName)
  await appendFile(transcriptPath, `${JSON.stringify({
    type: "message",
    id: `${sessionId}-user`,
    parentId: null,
    timestamp: "2026-07-30T00:00:01.000Z",
    message: { role: "user", content: [{ type: "text", text: "fixture turn" }] },
  })}\n`, "utf8")
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
      })}\n${JSON.stringify({
        type: "message",
        id: `${id}-user`,
        parentId: null,
        timestamp: "2026-07-30T00:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "fixture turn" }] },
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
  it.each([
    ["unset", false],
    ["set", true],
  ] as const)(
    "uses one prebuilt Host and preserves defaultSessionDir bytes with BORING_AGENT_SESSION_ROOT %s",
    async (_label, useConfiguredSessionRoot) => {
      const fixture = await fixtureApp(useConfiguredSessionRoot)
      const headers = { "x-boring-workspace-id": fixture.workspace.id }
      try {
        expect(fixture.createAgentHost).toHaveBeenCalledTimes(1)
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

        const legacyCatalog = await fixture.app.inject({ method: "GET", url: "/api/v1/agent/catalog", headers })
        expect(legacyCatalog.statusCode).toBe(200)

        const sessions = await fixture.app.inject({
          method: "GET",
          url: "/api/v1/agent/pi-chat/sessions",
          headers,
        })
        expect(sessions.statusCode).toBe(200)
        expect(sessions.json()).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: fixture.sessionId, title: "pre-MIG-CLI fixture" }),
        ]))
        expect(sessions.json().map((session: { id: string }) => session.id).sort())
          .toEqual(fixture.compatibleSessionIds)

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
          url: `/api/v1/agent/pi-chat/${fixture.sessionId}/state`,
          headers,
        })
        expect(state.statusCode).toBe(200)
        expect(state.json()).toMatchObject({ sessionId: fixture.sessionId, status: "idle" })
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
