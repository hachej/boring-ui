import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test, vi } from "vitest"

import {
  createBoringUiCliRuntimePlugin,
  provisionCliWorkspaceRuntime,
} from "../server/cli"
import type { RuntimeModeAdapter, WorkspaceProvisioningAdapter } from "@hachej/boring-agent/server"
import { getBoringAgentRuntimePaths } from "@hachej/boring-sandbox/providers/node-workspace"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function fakeAdapter(workspaceRoot: string, commands: Array<{ command: string; args: string[] }>): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: "direct",
    async exec(command, args) {
      commands.push({ command, args })
      if (command === "node" && args[0] === "--version") return { stdout: "v20.11.0\n" }
      if (command === "npm" && args[0] === "--version") return { stdout: "10.2.4\n" }
      if (command === "npm" && args[0] === "install") {
        const prefix = args[args.indexOf("--prefix") + 1]
        await mkdir(join(prefix, "node_modules", ".bin"), { recursive: true })
        await writeFile(join(prefix, "node_modules", ".bin", "boring-ui-plugin"), "#!/usr/bin/env node\n")
      }
    },
    async resolveInstallSource(source) {
      return String(source)
    },
    workspaceFs: {
      async exists(rel) {
        try {
          await readFile(toAbs(rel))
          return true
        } catch {
          return false
        }
      },
      async rm(rel) {
        await rm(toAbs(rel), { recursive: true, force: true })
      },
      async mkdir(rel) {
        await mkdir(toAbs(rel), { recursive: true })
      },
      async writeText(rel, content) {
        await mkdir(dirname(toAbs(rel)), { recursive: true })
        await writeFile(toAbs(rel), content)
      },
      async readText(rel) {
        try { return await readFile(toAbs(rel), "utf8") } catch { return null }
      },
      async copyFromHost() {},
    },
    getRuntimeCacheRoot() {
      return join(workspaceRoot, ".boring-agent", "cache")
    },
  }
}

test("CLI default runtime package installs the slim plugin CLI", () => {
  const plugin = createBoringUiCliRuntimePlugin()

  expect(plugin).toEqual({
    id: "boring-ui-plugin-cli-runtime",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-plugin-cli",
        packageName: "@hachej/boring-ui-plugin-cli",
        version: expect.any(String),
        expectedBins: ["boring-ui-plugin"],
      }],
    },
  })
})

test("CLI project/workspaces provisioning writes .boring-agent under the selected workspace", async () => {
  const workspaceRoot = await tempDir("boring-cli-selected-workspace-")
  const homeRoot = await tempDir("boring-cli-home-")
  const commands: Array<{ command: string; args: string[] }> = []

  const result = await provisionCliWorkspaceRuntime({
    workspaceRoot,
    mode: "direct",
    adapter: fakeAdapter(workspaceRoot, commands),
  })

  expect(result?.pathEntries).toContain(join(workspaceRoot, ".boring-agent", "node", "node_modules", ".bin"))
  await expect(readFile(join(workspaceRoot, ".boring-agent", "node", "node_modules", ".bin", "boring-ui-plugin"), "utf8")).resolves.toContain("node")
  await expect(readFile(join(homeRoot, ".boring-agent", "node", "node_modules", ".bin", "boring-ui-plugin"), "utf8")).rejects.toThrow()
  expect(commands.find((command) => command.command === "npm" && command.args[0] === "install")?.args).toContain("--prefix")
}, 15_000)

test("provisionWorkspace false performs no writes or package-source copies", async () => {
  const workspaceRoot = await tempDir("boring-cli-no-provision-")
  const commands: Array<{ command: string; args: string[] }> = []

  const result = await provisionCliWorkspaceRuntime({
    workspaceRoot,
    mode: "direct",
    provisionWorkspace: false,
    adapter: fakeAdapter(workspaceRoot, commands),
  })

  expect(result).toBeUndefined()
  expect(commands).toEqual([])
  await expect(readFile(join(workspaceRoot, ".boring-agent", ".gitignore"), "utf8")).rejects.toThrow()
})

test("CLI fallback provisions through one scoped runtime pair and releases it", async () => {
  const workspaceRoot = await tempDir("boring-cli-scoped-runtime-")
  const commands: Array<{ command: string; args: string[] }> = []
  const provisioningAdapter = fakeAdapter(workspaceRoot, commands)
  const disposeRuntime = vi.fn(async () => {})
  const runtimeContext = { runtimeCwd: workspaceRoot }
  const modeAdapter: Pick<RuntimeModeAdapter, "create"> = {
    async create() {
      return {
        workspace: {
          root: workspaceRoot,
          runtimeContext,
          fsCapability: "strong",
          async readFile() { return "" },
          async writeFile() {},
          async unlink() {},
          async readdir() { return [] },
          async stat() { return { kind: "file", size: 0, mtimeMs: 0 } },
          async mkdir() {},
          async rename() {},
        },
        sandbox: {
          id: "cli-scoped-runtime",
          placement: "server",
          provider: "direct",
          capabilities: ["exec"],
          runtimeContext,
          async exec() {
            return {
              stdout: new Uint8Array(),
              stderr: new Uint8Array(),
              exitCode: 0,
              durationMs: 0,
              truncated: false,
            }
          },
        },
        fileSearch: { async search() { return [] } },
        provisioningAdapter,
        disposeRuntime,
      }
    },
  }

  const result = await provisionCliWorkspaceRuntime({
    workspaceRoot,
    mode: "direct",
    modeAdapter,
    runtimeLayout: getBoringAgentRuntimePaths(workspaceRoot),
  })

  expect(result?.pathEntries).toContain(join(workspaceRoot, ".boring-agent", "node", "node_modules", ".bin"))
  expect(disposeRuntime).toHaveBeenCalledOnce()
})
