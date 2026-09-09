// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
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

describe("workspace session runtime migration", () => {
  test("continues a session carrying obsolete runtime metadata", async () => {
    const workspaceRoot = await tempDir("boring-ws-runtime-migration-root-")
    const sessionRoot = await tempDir("boring-ws-runtime-migration-sessions-")
    const namespace = sessionNamespaceForAgent(agentSpec, "default", "")!
    const store = new PiSessionStore(workspaceRoot, { sessionRoot, sessionNamespace: namespace })
    const seeded = await store.create({ workspaceId: "default" }, { title: "Historical session" })
    const transcriptPath = await sessionFilePath(join(sessionRoot, namespace), seeded.id)
    const lines = (await readFile(transcriptPath, "utf8")).trimEnd().split("\n")
    const header = JSON.parse(lines[0]!)
    header.boringSessionCtx.runtimeScopeIdentity = "obsolete-runtime-identity"
    await writeFile(transcriptPath, [JSON.stringify(header), ...lines.slice(1), ""].join("\n"))

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
      const response = await server.inject({
        method: "POST",
        url: `/api/v1/agents/alpha/sessions/${seeded.id}/rename`,
        payload: { requestId: "continue-rename", title: "Continued session" },
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json()).toMatchObject({ title: "Continued session" })
      expect(await readFile(transcriptPath, "utf8")).toContain('"name":"Continued session"')
    } finally {
      await server.close()
    }
  }, 120_000)
})
