import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { checkAuth } from "../cli.js"

const ENV_KEYS = ["PI_CODING_AGENT_DIR", "ANTHROPIC_API_KEY"] as const
let previousEnv: Record<(typeof ENV_KEYS)[number], string | undefined>
let agentDir: string

beforeEach(async () => {
  previousEnv = {
    PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  }
  agentDir = await mkdtemp(join(tmpdir(), "boring-cli-check-auth-"))
  process.env.PI_CODING_AGENT_DIR = agentDir
  delete process.env.ANTHROPIC_API_KEY
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key]
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
  await rm(agentDir, { recursive: true, force: true })
})

test("checkAuth discovers credentials from Pi auth.json", async () => {
  const withoutAuth = await checkAuth()
  await mkdir(agentDir, { recursive: true })
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify({ anthropic: { type: "api_key", key: "stored-test-secret" } }),
  )

  expect(await checkAuth()).toBeGreaterThan(withoutAuth)
})

test("checkAuth discovers provider credentials from the environment", async () => {
  const withoutAuth = await checkAuth()
  process.env.ANTHROPIC_API_KEY = "environment-test-secret"

  expect(await checkAuth()).toBeGreaterThan(withoutAuth)
})
