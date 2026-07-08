import type { RuntimeModeAdapter } from "@hachej/boring-agent/server"
import type { Sandbox, Workspace } from "@hachej/boring-agent/shared"

const runtimeContext = { runtimeCwd: "/workspace" }

export function createFakeVercelRuntimeModeAdapter(): RuntimeModeAdapter {
  const workspace: Workspace = {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
    fsCapability: "best-effort",
    async readFile() { return "" },
    async writeFile() {},
    async unlink() {},
    async readdir() { return [] },
    async stat() { return { size: 0, mtimeMs: 0, kind: "file" } },
    async mkdir() {},
    async rename() {},
  }
  const sandbox: Sandbox = {
    id: "fake-vercel-sandbox",
    placement: "remote",
    provider: "vercel-sandbox",
    capabilities: ["exec"],
    runtimeContext,
    async exec() {
      return {
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
        exitCode: 0,
        durationMs: 1,
        truncated: false,
      }
    },
  }
  return {
    id: "vercel-sandbox",
    workspaceFsCapability: "best-effort",
    async create(ctx) {
      return {
        storageRoot: ctx.workspaceRoot,
        workspace,
        sandbox,
        fileSearch: { search: async () => [] },
      }
    },
  }
}
