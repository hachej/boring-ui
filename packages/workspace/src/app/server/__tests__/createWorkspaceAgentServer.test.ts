import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const agentServerMock = vi.hoisted(() => ({
  createAgentApp: vi.fn(async () => ({
    register: vi.fn(async () => {}),
  })),
  provisionRuntimeWorkspace: vi.fn(async () => {}),
}))

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentApp: agentServerMock.createAgentApp,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
  }
})

import { createWorkspaceAgentServer } from "../createWorkspaceAgentServer"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.createAgentApp.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeHotPlugin(root: string, extension: string): Promise<void> {
  const pluginRoot = join(root, ".pi", "extensions", "hot-plugin")
  await mkdir(join(pluginRoot, "front"), { recursive: true })
  await mkdir(join(pluginRoot, "agent", "skills"), { recursive: true })
  await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() {}\n", "utf8")
  await writeFile(join(pluginRoot, "agent", extension), "export default function() {}\n", "utf8")
  await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
    name: "hot-plugin",
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
    pi: { extensions: [`agent/${extension}`], skills: ["agent/skills"] },
  }), "utf8")
}

describe("createWorkspaceAgentServer plugin runtime options", () => {
  test("getDynamicResources reflects current package.json#pi entries", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-package-pi-reload-")
    await writeHotPlugin(workspaceRoot, "one.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        beforeReload?: () => Promise<void>
        pi?: {
          extensionPaths?: string[]
          additionalSkillPaths?: string[]
          getDynamicResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] }
        }
      },
    ]
    // Static fields hold only host/workspace contributions, not package.json discoveries.
    expect(agentOptions.pi?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    // Dynamic getter holds the package.json-discovered values; Pi merges them.
    expect(agentOptions.pi?.getDynamicResources?.().extensionPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"),
    )
    expect(agentOptions.pi?.getDynamicResources?.().additionalSkillPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )

    await writeHotPlugin(workspaceRoot, "two.ts")
    await agentOptions.beforeReload?.()

    const refreshed = agentOptions.pi?.getDynamicResources?.()
    expect(refreshed?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    expect(refreshed?.extensionPaths).toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "two.ts"))
  })

  test("piPluginReload=false disables package.json Pi contributions while preserving host Pi options", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-agent-plugin-reload-off-")
    await writeHotPlugin(workspaceRoot, "one.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      piPluginReload: false,
      pi: {
        extensionPaths: [join(workspaceRoot, "host-extension.ts")],
        additionalSkillPaths: [join(workspaceRoot, "host-skills")],
      },
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { extensionPaths?: string[]; additionalSkillPaths?: string[]; extensionFactories?: unknown[] } },
    ]
    expect(agentOptions.pi?.extensionPaths).toEqual([join(workspaceRoot, "host-extension.ts")])
    expect(agentOptions.pi?.additionalSkillPaths).toContain(join(workspaceRoot, "host-skills"))
    expect(agentOptions.pi?.additionalSkillPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"))
    expect(agentOptions.pi?.extensionFactories).toEqual([])
  })

  test("boringPluginReload=false skips Boring asset refresh during agent reload", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-boring-reload-off-")
    await writeHotPlugin(workspaceRoot, "one.ts")
    const beforeReload = vi.fn(async () => {})

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      boringPluginReload: false,
      beforeReload,
    })

    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "hot-plugin")
    await writeFile(join(pluginRoot, "server.js"), "export const broken = true\n", "utf8")
    const pkg = JSON.parse(await readFile(join(pluginRoot, "package.json"), "utf8"))
    pkg.boring.server = "server.js"
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify(pkg), "utf8")

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()
    expect(beforeReload).toHaveBeenCalledTimes(1)
  })

  test("does not crash while collecting Pi entries from invalid package.json plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-invalid-package-pi-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "invalid-plugin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), "{ not json", "utf8")

    await expect(createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })).resolves.toBeTruthy()

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { extensionPaths?: string[]; additionalSkillPaths?: string[]; packages?: unknown[] } },
    ]
    expect(agentOptions.pi?.extensionPaths).not.toContain(join(pluginRoot, "agent", "index.ts"))
    expect(agentOptions.pi?.additionalSkillPaths).not.toContain(join(pluginRoot, "agent", "skills"))
    expect(agentOptions.pi?.packages).toContainEqual(expect.objectContaining({
      skills: ["skills/boring-plugin-authoring"],
    }))
  })

  test("normalizes package.json Pi packages relative to the plugin root", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-package-pi-root-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "package-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "package-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: {
        packages: [
          "file:.",
          { source: "./agent", extensions: ["index.ts"] },
          "npm:remote-plugin",
        ],
      },
    }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { packages?: unknown[]; getDynamicResources?: () => { packages?: unknown[] } } },
    ]
    // pi.packages is the STATIC set: bundled @hachej/boring-pi skill +
    // host-supplied + factory-plugin entries. The bundled skill is added
    // when @hachej/boring-pi is resolvable from the workspace.
    expect(agentOptions.pi?.packages ?? []).toContainEqual(
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    )
    // The package.json#pi.packages discovered for the test plugin live in
    // getDynamicResources() so hot reload can re-read them.
    expect(agentOptions.pi?.getDynamicResources?.().packages).toEqual([
      join(pluginRoot),
      { source: join(pluginRoot, "agent"), extensions: ["index.ts"] },
      "npm:remote-plugin",
    ])
  })

  test("forwards plugin Pi packages to the agent runtime", async () => {
    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/workspace-pi-forwarding",
      logger: false,
      provisionWorkspace: false,
      pi: {
        packages: [
          "npm:host-pi",
          {
            source: "npm:plugin-pi",
            extensions: ["./b.ts", "./a.ts"],
          },
        ],
      },
      plugins: [
        {
          id: "plugin-pi",
          piPackages: [
            {
              source: "npm:plugin-pi",
              extensions: ["./a.ts", "./b.ts"],
            },
          ],
        },
      ],
    })

    expect(agentServerMock.createAgentApp).toHaveBeenCalledTimes(1)
    const [agentOptions] = agentServerMock.createAgentApp.mock
      .calls[0] as unknown as [
      { pi?: { packages?: unknown[] } },
    ]
    // Static set: bundled @hachej/boring-pi skill (when resolvable) +
    // factory-plugin contributions + host-supplied entries.
    expect(agentOptions.pi?.packages).toContainEqual(
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    )
    expect(agentOptions.pi?.packages).toContainEqual({
      source: "npm:plugin-pi",
      extensions: ["./a.ts", "./b.ts"],
    })
    expect(agentOptions.pi?.packages).toContain("npm:host-pi")
  })

  test("getDynamicResources reflects package.json#pi changes between calls", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-pi-dynamic-")
    const pluginRoot = join(workspaceRoot, ".pi", "extensions", "dyn-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "dyn-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { packages: ["npm:initial"] },
    }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { pi?: { getDynamicResources?: () => { packages?: unknown[] } } },
    ]
    expect(agentOptions.pi?.getDynamicResources?.().packages).toEqual(["npm:initial"])

    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "dyn-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { packages: ["npm:updated"] },
    }), "utf8")
    expect(agentOptions.pi?.getDynamicResources?.().packages).toEqual(["npm:updated"])
  })

  test("plugins[] accepts pre-built objects", async () => {
    const builtPlugin = { id: "built", systemPrompt: "BUILT" }

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase0-mixed-entries",
      logger: false,
      provisionWorkspace: false,
      plugins: [builtPlugin],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("BUILT")
  })

})

describe("directory-source plugin entries", () => {
  async function writeDirPlugin(opts: {
    dir: string
    serverEntry?: string  // path inside dir
    factory?: boolean     // export factory vs object
    optionsKey?: string
  }): Promise<void> {
    await mkdir(opts.dir, { recursive: true })
    const serverRel = opts.serverEntry ?? "src/server/index.ts"
    await mkdir(join(opts.dir, serverRel.split("/").slice(0, -1).join("/")), { recursive: true })
    const body = opts.factory
      ? `export default function (options, ctx) {
           return { id: "dir-factory", systemPrompt: "OPTS=" + JSON.stringify(options ?? {}) + " ROOT=" + ctx.workspaceRoot }
         }`
      : `export default { id: "dir-object", systemPrompt: "OBJECT_PROMPT" }`
    await writeFile(join(opts.dir, serverRel), body, "utf8")
    const pkg: Record<string, unknown> = { name: "test-plugin" }
    if (opts.serverEntry && opts.serverEntry !== "src/server/index.ts") {
      pkg.boring = { server: opts.serverEntry }
    }
    await writeFile(join(opts.dir, "package.json"), JSON.stringify(pkg), "utf8")
  }

  test("dir entry with factory export receives options and ctx", async () => {
    const dir = await makeTempDir("phase1-dir-factory-")
    await writeDirPlugin({ dir, factory: true })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, options: { adapter: "abc" }, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain('OPTS={"adapter":"abc"}')
    expect(agentOptions.systemPromptAppend).toContain("ROOT=/tmp/phase1-host")
  })

  test("dir entry with object export passes through", async () => {
    const dir = await makeTempDir("phase1-dir-object-")
    await writeDirPlugin({ dir, factory: false })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-obj-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("OBJECT_PROMPT")
  })

  test("dir entry honors explicit boring.server manifest field", async () => {
    const dir = await makeTempDir("phase1-explicit-")
    await writeDirPlugin({ dir, serverEntry: "src/custom/srv.ts", factory: true })

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-explicit-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("OPTS={}")
  })

  test("dir entry: declared-but-missing manifest field throws loudly", async () => {
    const dir = await makeTempDir("phase1-missing-")
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "missing", boring: { server: "src/server/missing.ts" } }),
      "utf8",
    )

    await expect(
      createWorkspaceAgentServer({
        workspaceRoot: "/tmp/phase1-missing-host",
        logger: false,
        provisionWorkspace: false,
        plugins: [{ dir, hotReload: true }],
      }),
    ).rejects.toThrow(/declared but not found/)
  })

})

describe("beforeReload triggers directory-source re-resolve", () => {
  test("editing a dir-source plugin's server entry shows up after /reload (via beforeReload)", async () => {
    const dir = await makeTempDir("phase5-reload-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'p5', systemPrompt: 'V1' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p5" }), "utf8")

    const app = await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    // Edit the plugin's server module
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'p5', systemPrompt: 'V2_AFTER_RELOAD' }",
      "utf8",
    )

    // Simulate /reload firing via the beforeReload hook captured by createAgentApp.
    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    await expect(agentOptions.beforeReload?.()).resolves.toBeUndefined()

    // The exposed rebuild closure should reflect the new content.
    const rebuilt = await (app as unknown as { __boringRebuildPlugins: () => Promise<{ plugins: { id: string; systemPrompt?: string }[] }> }).__boringRebuildPlugins()
    expect(rebuilt.plugins[0].systemPrompt).toBe("V2_AFTER_RELOAD")
  })

  test("dir-source plugin re-resolve failure surfaces as a 422-style throw in beforeReload", async () => {
    const dir = await makeTempDir("phase5-bad-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'good', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p" }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-bad-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    // Replace the server entry with a syntax error so the next jiti import throws.
    await writeFile(join(dir, "src", "server", "index.ts"), "this is not valid typescript {{", "utf8")

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<void> },
    ]
    await expect(agentOptions.beforeReload?.()).rejects.toThrow(/Boring plugin re-resolve failed/)
  })
})
