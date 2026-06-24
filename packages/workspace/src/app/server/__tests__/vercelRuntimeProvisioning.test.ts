import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test } from "vitest"
import {
  createVercelProvisioningAdapter,
  getBoringAgentRuntimePaths,
  type RuntimeModeAdapter,
  type WorkspaceProvisioningAdapter,
  type WorkspaceProvisioningExecResult,
} from "@hachej/boring-agent/server"
import type { Workspace, Sandbox } from "@hachej/boring-agent/shared"

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"
import { defineServerPlugin } from "../../../server/plugins/defineServerPlugin"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function createDummySdkPackage(): Promise<string> {
  const root = await tempDir("boring-vercel-dummy-sdk-")
  await mkdir(join(root, "bin"), { recursive: true })
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "dummy-vercel-sdk",
    version: "1.0.0",
    bin: { "dummy-vercel-sdk": "bin/dummy-vercel-sdk.js" },
  }, null, 2))
  await writeFile(join(root, "bin", "dummy-vercel-sdk.js"), "#!/usr/bin/env node\nconsole.log('dummy-vercel-sdk')\n")
  return root
}

async function createDummySkill(): Promise<string> {
  const root = await tempDir("boring-vercel-skill-")
  await writeFile(join(root, "SKILL.md"), "---\nname: vercel-dummy-skill\ndescription: Vercel dummy skill\n---\n# Vercel dummy skill\n")
  return root
}

function createMemoryWorkspaceFs(files: Map<string, string>): WorkspaceProvisioningAdapter["workspaceFs"] {
  const dirs = new Set<string>(["."])
  const normalize = (rel: string) => rel.replace(/^\/+/, "").replace(/\/+/g, "/")
  const mkdirRel = async (rel: string) => {
    const parts = normalize(rel).split("/").filter(Boolean)
    let current = ""
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      dirs.add(current)
    }
  }

  return {
    async exists(rel) {
      const path = normalize(rel)
      return files.has(path) || dirs.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`))
    },
    async rm(rel) {
      const path = normalize(rel)
      for (const key of [...files.keys()]) if (key === path || key.startsWith(`${path}/`)) files.delete(key)
      for (const key of [...dirs]) if (key === path || key.startsWith(`${path}/`)) dirs.delete(key)
    },
    async mkdir(rel) {
      await mkdirRel(rel)
    },
    async writeText(rel, content) {
      const path = normalize(rel)
      await mkdirRel(dirname(path))
      files.set(path, content)
    },
    async readText(rel) {
      return files.get(normalize(rel)) ?? null
    },
    async copyFromHost(source, rel) {
      const sourcePath = source instanceof URL ? source.pathname : source
      const path = normalize(rel)
      const sourceStat = await stat(sourcePath)
      if (sourceStat.isDirectory()) {
        await mkdirRel(path)
        for (const entry of await readdir(sourcePath)) {
          await this.copyFromHost(join(sourcePath, entry), `${path}/${entry}`)
        }
        return
      }
      await mkdirRel(dirname(path))
      files.set(path, await readFile(sourcePath, "utf8"))
    },
  }
}

function createFakeVercelMode(state: {
  files: Map<string, string>
  artifacts: string[]
  installs: number
}): RuntimeModeAdapter {
  const workspaceRoot = "/workspace"
  const runtimeContext = { runtimeCwd: workspaceRoot }
  const workspace: Workspace = {
    root: workspaceRoot,
    runtimeContext,
    fsCapability: "best-effort",
    async readFile(rel) { return state.files.get(rel) ?? "" },
    async writeFile(rel, data) { state.files.set(rel, data) },
    async unlink(rel) { state.files.delete(rel) },
    async readdir() { return [] },
    async stat() { return { size: 0, mtimeMs: 0, kind: "file" } },
    async mkdir() {},
    async rename(from, to) {
      const value = state.files.get(from)
      if (value !== undefined) state.files.set(to, value)
      state.files.delete(from)
    },
  }
  const sandbox: Sandbox = {
    id: "fake-vercel-sandbox",
    placement: "remote",
    provider: "vercel-sandbox",
    capabilities: ["exec"],
    runtimeContext,
    async exec() {
      return { stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0, durationMs: 1, truncated: false }
    },
  }

  return {
    id: "vercel-sandbox",
    workspaceFsCapability: "best-effort",
    createProvisioningAdapter(runtimeLayout) {
      const workspaceFs = createMemoryWorkspaceFs(state.files)
      return createVercelProvisioningAdapter({
        runtimeLayout,
        workspaceFs,
        async prepareArtifact(request) {
          state.artifacts.push(`${request.kind}:${request.id}:${request.source}`)
          await writeFile(request.outputPath, `artifact:${request.id}`)
        },
        async exec(command, args): Promise<WorkspaceProvisioningExecResult | void> {
          if (command === "node" && args[0] === "--version") return { stdout: "v20.11.0\n" }
          if (command === "npm" && args[0] === "--version") return { stdout: "10.2.4\n" }
          if (command === "npm" && args[0] === "install") {
            state.installs += 1
            await workspaceFs.writeText(".boring-agent/node/package-lock.json", "{\"lockfileVersion\":3}\n")
            await workspaceFs.writeText(".boring-agent/node/node_modules/.bin/dummy-vercel-sdk", "#!/usr/bin/env node\n")
          }
        },
      })
    },
    async create(ctx) {
      return { storageRoot: ctx.workspaceRoot, workspace, sandbox, fileSearch: { search: async () => [] } }
    },
  }
}

test("createWorkspaceAgentServer provisions Vercel-like new sandboxes with mirrored skills and artifact-backed SDK CLIs", async () => {
  const hostWorkspaceRoot = await tempDir("boring-host-workspace-")
  const packageRoot = await createDummySdkPackage()
  const skillRoot = await createDummySkill()
  const state = { files: new Map<string, string>(), artifacts: [] as string[], installs: 0 }
  const app = await createWorkspaceAgentServer({
    workspaceRoot: hostWorkspaceRoot,
    runtimeModeAdapter: createFakeVercelMode(state),
    logger: false,
    plugins: [defineServerPlugin({
      id: "dummy-vercel-plugin",
      skills: [{ name: "vercel-dummy-skill", source: skillRoot }],
      provisioning: {
        nodePackages: [{
          id: "dummy-vercel-sdk",
          packageName: "dummy-vercel-sdk",
          packageRoot,
          expectedBins: ["dummy-vercel-sdk"],
        }],
      },
    })],
  })

  try {
    expect(state.files.get(".boring-agent/skills/dummy-vercel-plugin/vercel-dummy-skill/SKILL.md"))
      .toContain("Vercel dummy skill")
    expect([...state.files.keys()].some((key) => key.startsWith(".boring-agent/tmp/dummy-vercel-sdk-") && key.endsWith(".tgz"))).toBe(true)
    expect(state.files.get(".boring-agent/node/node_modules/.bin/dummy-vercel-sdk")).toContain("node")
    expect(state.installs).toBe(1)
    expect(state.artifacts).toContain(`node:dummy-vercel-sdk:${packageRoot}`)

    const catalog = await app.inject({ method: "GET", url: "/api/v1/agent/catalog" })
    expect(catalog.statusCode).toBe(200)
  } finally {
    await app.close()
  }
})
