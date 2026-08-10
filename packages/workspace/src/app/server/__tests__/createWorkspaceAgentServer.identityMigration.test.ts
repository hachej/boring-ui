// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { AgentGatewayErrorCode } from "../../../../../agent/src/shared/index"
import { PiSessionStore } from "../../../../../agent/src/server/harness/pi-coding-agent/sessions"
import { sessionNamespaceForAgent } from "../../../../../agent/src/server/agent-host/sessionInventory"
import { sessionFilePath } from "../../../../../agent/src/server/harness/pi-coding-agent/__tests__/fixtures/sessionFiles"
import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

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

describe("workspace runtime identity hard cut", () => {
  test("keeps a session with a predecessor pin read-only and leaves its transcript unchanged", async () => {
    const workspaceRoot = await tempDir("boring-ws-hard-cut-root-")
    const sessionRoot = await tempDir("boring-ws-hard-cut-sessions-")
    const server = await createWorkspaceAgentServer({
      workspaceRoot,
      sessionRoot,
      mode: "direct",
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
      agents: [agentSpec],
      defaultAgentTypeId: "alpha",
    })

    try {
      const namespace = sessionNamespaceForAgent(agentSpec, "default", "")!
      const store = new PiSessionStore(workspaceRoot, { sessionRoot, sessionNamespace: namespace })
      const seeded = await store.create(
        { workspaceId: "default", runtimeScopeIdentity: "predecessor-runtime-identity" },
        { title: "Historical session" },
      )
      const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), seeded.id)
      const before = await readFile(transcriptPath)

      const response = await server.inject({
        method: "POST",
        url: `/api/v1/agents/alpha/sessions/${seeded.id}/rename`,
        payload: { requestId: "hard-cut-rename", title: "Must not change" },
      })

      expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400)
      expect(response.json()).toMatchObject({
        error: expect.objectContaining({ code: AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH }),
      })
      expect((await readFile(transcriptPath)).equals(before)).toBe(true)
    } finally {
      await server.close()
    }
  }, 120_000)
})
