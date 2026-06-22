import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import { createDataBridgeServerPlugin } from "./index"

let app: Awaited<ReturnType<typeof createWorkspaceAgentServer>> | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function createApp() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "data-bridge-test-"))
  writeFileSync(join(workspaceRoot, "data.csv"), "id,role\n1,engineer\n2,designer\n3,engineer\n")
  const outside = join(workspaceRoot, "..", "outside.csv")
  writeFileSync(outside, "id,role\n1,secret\n")
  symlinkSync(outside, join(workspaceRoot, "linked-outside.csv"))
  app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: "local",
    logger: false,
    plugins: [createDataBridgeServerPlugin({ workspaceRoot })],
    workspaceBridge: { allowInsecureLocalCliBrowserAuth: true },
  })
  return app
}

async function query(path: string, overrides: Record<string, unknown> = {}) {
  const server = await createApp()
  return await server.inject({
    method: "POST",
    url: "/api/v1/workspace-bridge/call",
    headers: { "content-type": "application/json" },
    payload: {
      op: "data.v1.query.run",
      input: {
        query: {
          language: "bsl-dashboard",
          model: "people",
          groupBy: ["role"],
          measures: ["count"],
          dataRef: { kind: "workspace-file", path },
          ...overrides,
        },
      },
    },
  })
}

describe("data bridge workspace-file adapter", () => {
  it("aggregates workspace CSV data through WorkspaceBridge", async () => {
    const res = await query("data.csv")

    expect(res.statusCode).toBe(200)
    expect(res.json().output.rows).toEqual([
      { role: "engineer", count: 2 },
      { role: "designer", count: 1 },
    ])
  })

  it("honors dimensions as the grouping field fallback", async () => {
    const res = await query("data.csv", { groupBy: undefined, dimensions: ["role"] })

    expect(res.statusCode).toBe(200)
    expect(res.json().output.rows).toEqual([
      { role: "engineer", count: 2 },
      { role: "designer", count: 1 },
    ])
  })

  it("rejects workspace file paths that escape the workspace root", async () => {
    const res = await query("../outside.csv")

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.json().ok).toBe(false)
  })

  it("rejects symlinks that resolve outside the workspace root", async () => {
    const res = await query("linked-outside.csv")

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(res.json().ok).toBe(false)
  })
})
