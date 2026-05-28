import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, expect, test } from "vitest"

import {
  createBoringUiCliRuntimePlugin,
  provisionCliWorkspaceRuntime,
} from "../server/cli"
import type { WorkspaceProvisioningAdapter } from "@hachej/boring-agent/server"

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
        await writeFile(join(prefix, "node_modules", ".bin", "boring-ui"), "#!/usr/bin/env node\n")
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

test("CLI default runtime package is a structural plugin-like object", () => {
  const plugin = createBoringUiCliRuntimePlugin("/tmp/cli package")

  expect(plugin).toEqual({
    id: "boring-ui-cli-runtime",
    provisioning: {
      nodePackages: [{
        id: "boring-ui-cli",
        packageName: "@hachej/boring-ui-cli",
        packageRoot: "/tmp/cli package",
        version: expect.any(String),
        expectedBins: ["boring-ui"],
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
  await expect(readFile(join(workspaceRoot, ".boring-agent", "node", "node_modules", ".bin", "boring-ui"), "utf8")).resolves.toContain("node")
  await expect(readFile(join(homeRoot, ".boring-agent", "node", "node_modules", ".bin", "boring-ui"), "utf8")).rejects.toThrow()
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
