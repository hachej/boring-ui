// @vitest-environment node

import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []
const ORIGINAL_SESSION_ROOT = process.env.BORING_AGENT_SESSION_ROOT

afterEach(async () => {
  if (ORIGINAL_SESSION_ROOT === undefined) delete process.env.BORING_AGENT_SESSION_ROOT
  else process.env.BORING_AGENT_SESSION_ROOT = ORIGINAL_SESSION_ROOT
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const baseOptions = {
  mode: "direct" as const,
  logger: false,
  provisionWorkspace: false,
  externalPlugins: false,
}

describe("workspace agent server request ledger placement", () => {
  test("honors an explicit host-owned requestLedgerPath", async () => {
    const workspaceRoot = await tempDir("boring-ws-ledger-root-")
    const hostState = await tempDir("boring-ws-ledger-host-")
    const requestLedgerPath = join(hostState, "agent-state", "request-ledger.sqlite")
    process.env.BORING_AGENT_SESSION_ROOT = await tempDir("boring-ws-ledger-env-")

    const server = await createWorkspaceAgentServer({
      ...baseOptions,
      workspaceRoot,
      sessionRoot: await tempDir("boring-ws-ledger-sessions-"),
      requestLedgerPath,
    })

    try {
      expect(existsSync(requestLedgerPath)).toBe(true)
      expect(existsSync(join(workspaceRoot, ".boring", "agent-request-ledger.sqlite"))).toBe(false)
    } finally {
      await server.close()
    }
  }, 120_000)


  // The explicit-path case above proves the wiring; the full four-case
  // precedence matrix is unit-owned by requestLedgerPath.test.ts. The one
  // behavior unique to THIS host is its legacy tail (.boring/), kept below.
  test("keeps the legacy .boring workspace ledger when no host path is configured", async () => {
    const workspaceRoot = await tempDir("boring-ws-ledger-root-")
    delete process.env.BORING_AGENT_SESSION_ROOT

    const server = await createWorkspaceAgentServer({ ...baseOptions, workspaceRoot })

    try {
      expect(existsSync(join(workspaceRoot, ".boring", "agent-request-ledger.sqlite"))).toBe(true)
    } finally {
      await server.close()
    }
  }, 120_000)
})
