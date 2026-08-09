// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createWorkspaceAgentServer, type WorkspaceRuntimeScopeV1Migration } from "../createWorkspaceAgentServer"
import {
  createLegacyRuntimeScopeIdentityV1,
  createResolvedRuntimeScopeIdentity,
} from "@hachej/boring-agent/server"
import { PiSessionStore } from "../../../../../agent/src/server/harness/pi-coding-agent/sessions"
import { sessionNamespaceForAgent } from "../../../../../agent/src/server/agent-host/sessionInventory"
import { sessionFilePath } from "../../../../../agent/src/server/harness/pi-coding-agent/__tests__/fixtures/sessionFiles"

// Spy (not stub) the identity formulas: the server-side reproduction check must
// run for real, while the test observes the exact digests the server computes.
vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createLegacyRuntimeScopeIdentityV1: vi.fn(actual.createLegacyRuntimeScopeIdentityV1),
    createResolvedRuntimeScopeIdentity: vi.fn(actual.createResolvedRuntimeScopeIdentity),
  }
})

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const agentSpec = { agentTypeId: "alpha", definition: { label: "Alpha", instructions: "alpha instructions" } }

function migrationEntry(expectedIdentity: string): WorkspaceRuntimeScopeV1Migration {
  return {
    agentTypeId: "alpha",
    expectedIdentity,
    legacyPlacementIdentity: "legacy-placement",
    legacyProvisioningGeneration: "legacy-generation",
    evidenceDigest: "e".repeat(64),
  }
}

async function bootServer(input: {
  workspaceRoot: string
  sessionRoot: string
  migrations: readonly WorkspaceRuntimeScopeV1Migration[]
}) {
  return await createWorkspaceAgentServer({
    workspaceRoot: input.workspaceRoot,
    sessionRoot: input.sessionRoot,
    mode: "direct",
    logger: false,
    provisionWorkspace: false,
    externalPlugins: false,
    agents: [agentSpec],
    defaultAgentTypeId: "alpha",
    runtimeScopeIdentityMigrations: input.migrations,
  })
}

function lastResult(fn: unknown): string {
  const mock = (fn as ReturnType<typeof vi.fn>).mock
  const result = mock.results[mock.results.length - 1]
  if (!result || result.type !== "return") throw new Error("identity formula spy captured no result")
  return result.value as string
}

describe("workspace-level runtime identity migration (WorkspaceRuntimeScopeV1Migration)", () => {
  test("reproduces the legacy pin, adopts a seeded legacy session, and fails closed on a wrong expectedIdentity", async () => {
    const workspaceRoot = await tempDir("boring-ws-idmig-root-")
    const sessionRoot = await tempDir("boring-ws-idmig-sessions-")

    // Era 1: a deliberately wrong expectedIdentity. The server must refuse to
    // serve agent runtime scope while still computing (and letting us capture)
    // the true legacy digest for the configured legacy placement/generation.
    const wrongServer = await bootServer({
      workspaceRoot,
      sessionRoot,
      migrations: [migrationEntry("0".repeat(64))],
    })
    let legacyIdentity: string
    let currentIdentity: string
    let namespace: string
    let transcriptPath: string
    let seededBytes: Buffer
    try {
      const probe = await wrongServer.inject({
        method: "POST",
        url: "/api/v1/agents/alpha/sessions",
        payload: { title: "probe" },
      })
      // Fail-closed: reproduction mismatch must refuse the request entirely.
      expect(probe.statusCode, probe.body).toBeGreaterThanOrEqual(400)
      expect(probe.json()).toMatchObject({ error: expect.objectContaining({ code: expect.any(String) }) })
      legacyIdentity = lastResult(createLegacyRuntimeScopeIdentityV1)
      currentIdentity = lastResult(createResolvedRuntimeScopeIdentity)
      expect(legacyIdentity).toMatch(/^[a-f0-9]{64}$/)
      expect(currentIdentity).toMatch(/^[a-f0-9]{64}$/)
      expect(legacyIdentity).not.toBe(currentIdentity)

      // Seed a legacy-identity session directly into the server's store, the
      // way a pre-migration deployment would have written it.
      namespace = sessionNamespaceForAgent(agentSpec, "default", "")!
      const store = new PiSessionStore(workspaceRoot, { sessionRoot, sessionNamespace: namespace })
      const seeded = await store.create(
        { workspaceId: "default", runtimeScopeIdentity: legacyIdentity },
        { title: "Legacy session" },
      )
      transcriptPath = await sessionFilePath(join(sessionRoot, namespace), seeded.id)
      seededBytes = await readFile(transcriptPath)

      // Fail-closed against the seeded data too: the wrong-evidence server may
      // not adopt or touch it.
      const denied = await wrongServer.inject({
        method: "POST",
        url: `/api/v1/agents/alpha/sessions/${seeded.id}/rename`,
        payload: { requestId: "denied-rename", title: "Must not change" },
      })
      expect(denied.statusCode, denied.body).toBeGreaterThanOrEqual(400)
      expect((await readFile(transcriptPath)).equals(seededBytes)).toBe(true)

      // Era 2: correct reproduction evidence adopts the seeded session.
      const migratingServer = await bootServer({
        workspaceRoot,
        sessionRoot,
        migrations: [migrationEntry(legacyIdentity)],
      })
      try {
        const renamed = await migratingServer.inject({
          method: "POST",
          url: `/api/v1/agents/alpha/sessions/${seeded.id}/rename`,
          payload: { requestId: "adopting-rename", title: "Adopted" },
        })
        expect(renamed.statusCode).toBe(200)

        const after = await readFile(transcriptPath)
        const header = JSON.parse(after.subarray(0, after.indexOf(0x0a)).toString("utf8")) as {
          boringSessionCtx?: {
            runtimeScopeIdentity?: string
            runtimeScopeIdentityMigration?: {
              schemaVersion?: number
              fromIdentity?: string
              toIdentity?: string
              evidenceDigest?: string
            }
          }
        }
        expect(header.boringSessionCtx?.runtimeScopeIdentity).toBe(currentIdentity)
        expect(header.boringSessionCtx?.runtimeScopeIdentityMigration).toMatchObject({
          schemaVersion: 1,
          fromIdentity: legacyIdentity,
          toIdentity: currentIdentity,
          evidenceDigest: "e".repeat(64),
        })

        // The adopted session remains fully usable through the same surface.
        const state = await migratingServer.inject({
          method: "GET",
          url: `/api/v1/agents/alpha/sessions/${seeded.id}/state`,
        })
        expect(state.statusCode, state.body).toBe(200)
        expect(state.json()).toMatchObject({ summary: expect.objectContaining({ title: "Adopted" }) })
      } finally {
        await migratingServer.close()
      }
    } finally {
      await wrongServer.close()
    }
  }, 120_000)
})
