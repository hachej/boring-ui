import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test, vi } from "vitest"

import type { Sandbox as VercelSandbox } from "@vercel/sandbox"
import type {
  SandboxHandleRecord,
  SandboxHandleStore,
} from "../../../../../packages/agent/src/shared/sandbox-handle-store"
import {
  resetSandboxHandleCacheForTests,
  type VercelSandboxClient,
} from "../../../../../packages/agent/src/server/sandbox/vercel-sandbox/resolveSandboxHandle"
import { createMockVercelSandboxHarness } from "../../../../../packages/agent/src/server/workspace/__tests__/helpers/mockVercelSandbox"
import { createVercelSandboxModeAdapter } from "../../../../../packages/agent/src/server/runtime/modes/vercel-sandbox"
import { prepareMacroSandboxTemplate } from "../macroSandboxTemplate"

function createStore(initial: SandboxHandleRecord[] = []): SandboxHandleStore {
  const records = new Map(initial.map((record) => [record.workspaceId, record]))

  return {
    async get(workspaceId) {
      return records.get(workspaceId) ?? null
    },
    async put(record) {
      records.set(record.workspaceId, record)
    },
    async delete(workspaceId) {
      records.delete(workspaceId)
    },
    async list() {
      return [...records.values()]
    },
  }
}

function addSandboxMeta(sandbox: VercelSandbox): VercelSandbox {
  const target = sandbox as VercelSandbox & {
    sandboxId: string
    status: string
    persistent: boolean
  }
  target.sandboxId = "sb-macro-sdk-upgrade"
  target.status = "running"
  target.persistent = true
  return sandbox
}

async function patchTemplateSdkVersion(templateRoot: string, version: string): Promise<void> {
  const pyprojectPath = join(templateRoot, ".boring-agent", "sdk", "boring-macro-sdk", "pyproject.toml")
  const pyproject = await readFile(pyprojectPath, "utf-8")
  await writeFile(pyprojectPath, pyproject.replace(/version = "[^"]+"/, `version = "${version}"`), "utf-8")

  const diffPath = join(
    templateRoot,
    ".boring-agent",
    "sdk",
    "boring-macro-sdk",
    "boring_macro",
    "transforms",
    "builtins",
    "diff.py",
  )
  await writeFile(diffPath, `${await readFile(diffPath, "utf-8")}\nUPGRADE_SENTINEL = "${version}"\n`, "utf-8")
}

afterEach(() => {
  resetSandboxHandleCacheForTests()
})

test("macro sandbox template integration upgrades SDK files in an existing workspace without deleting user transforms", async () => {
  const cleanupRoots: string[] = []
  const oldTemplateRoot = await prepareMacroSandboxTemplate()
  const upgradedTemplateRoot = await prepareMacroSandboxTemplate()
  cleanupRoots.push(oldTemplateRoot, upgradedTemplateRoot)

  await patchTemplateSdkVersion(oldTemplateRoot, "0.1.0-old")
  await patchTemplateSdkVersion(upgradedTemplateRoot, "0.1.0-upgraded")

  const harness = await createMockVercelSandboxHarness()
  const sandbox = addSandboxMeta(harness.sandbox)
  const workspaceId = `macro-sdk-upgrade-${Date.now()}`
  const store = createStore([{
    workspaceId,
    sandboxId: "sb-macro-sdk-upgrade",
    createdAt: "2026-05-08T00:00:00.000Z",
    lastUsedAt: "2026-05-08T00:00:00.000Z",
  }])
  const client: VercelSandboxClient = {
    create: vi.fn(),
    get: vi.fn(async () => sandbox),
  }
  const logger = { info: vi.fn(), warn: vi.fn() }
  const adapter = createVercelSandboxModeAdapter({
    store,
    vercelClient: client,
    orphanGuardMaxIdleMs: null,
    packageTemplateOpts: { uploadFn: vi.fn(async () => "https://blob.test/macro-template.tar.gz") },
    getEnvVar(name) {
      if (name === "VERCEL_TOKEN") return "token-1"
      if (name === "VERCEL_TEAM_ID") return "team-1"
      return undefined
    },
    logger,
  })

  try {
    const firstBundle = await adapter.create({
      workspaceRoot: workspaceId,
      workspaceId,
      sessionId: "session-macro-sdk-upgrade-1",
      templatePath: oldTemplateRoot,
    })
    await firstBundle.workspace.writeFile("transforms/custom/user_transform.py", "# user-owned transform\n")

    await expect(firstBundle.workspace.readFile(".boring-agent/sdk/boring-macro-sdk/pyproject.toml"))
      .resolves.toContain('version = "0.1.0-old"')

    const secondBundle = await adapter.create({
      workspaceRoot: workspaceId,
      workspaceId,
      sessionId: "session-macro-sdk-upgrade-2",
      templatePath: upgradedTemplateRoot,
    })

    await expect(secondBundle.workspace.readFile(".boring-agent/sdk/boring-macro-sdk/pyproject.toml"))
      .resolves.toContain('version = "0.1.0-upgraded"')
    await expect(secondBundle.workspace.readFile(".boring-agent/sdk/boring-macro-sdk/boring_macro/transforms/builtins/diff.py"))
      .resolves.toContain('UPGRADE_SENTINEL = "0.1.0-upgraded"')
    await expect(secondBundle.workspace.readFile("transforms/custom/user_transform.py"))
      .resolves.toBe("# user-owned transform\n")
    await expect(secondBundle.workspace.readFile(".agents/skills/macro-transform/SKILL.md"))
      .resolves.toContain("macro-transform")

    expect(client.create).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      "[vercel-sandbox:mode] template seeded into workspace",
      expect.objectContaining({ fileCount: expect.any(Number) }),
    )
    expect(logger.info).not.toHaveBeenCalledWith(
      "[vercel-sandbox:mode] template already seeded",
      expect.objectContaining({ hash: expect.any(String) }),
    )
  } finally {
    await harness.cleanup()
    await Promise.all(cleanupRoots.map((root) => rm(root, { recursive: true, force: true })))
  }
})
