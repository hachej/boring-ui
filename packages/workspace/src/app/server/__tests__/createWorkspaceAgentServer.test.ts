import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Fastify from "fastify"
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

import {
  createWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  resolveDefaultWorkspacePluginPackagePaths,
} from "../createWorkspaceAgentServer"

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

describe("workspace app-server plugin package helpers", () => {
  test("resolve defaults from app package manifest and read static Pi package resources", async () => {
    const appRoot = await makeTempDir("boring-app-helper-default-package-")
    const manifestPluginRoot = join(appRoot, "plugins", "manifest-plugin")
    const explicitPluginRoot = join(appRoot, "plugins", "explicit-plugin")
    await mkdir(join(manifestPluginRoot, "skills"), { recursive: true })
    await mkdir(join(explicitPluginRoot, "agent"), { recursive: true })
    await writeFile(join(manifestPluginRoot, "package.json"), JSON.stringify({
      name: "manifest-plugin",
      pi: { skills: ["skills"], packages: ["npm:manifest-pi"] },
    }), "utf8")
    await writeFile(join(explicitPluginRoot, "package.json"), JSON.stringify({
      name: "explicit-plugin",
      pi: { extensions: ["agent/index.ts"] },
    }), "utf8")
    await writeFile(join(explicitPluginRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    const appPackageJsonPath = join(appRoot, "package.json")
    await writeFile(appPackageJsonPath, JSON.stringify({
      name: "temp-app",
      boring: { defaultPluginPackages: ["./plugins/manifest-plugin"] },
    }), "utf8")

    const paths = resolveDefaultWorkspacePluginPackagePaths({
      workspaceRoot: appRoot,
      appPackageJsonPath,
      defaultPluginPackages: [explicitPluginRoot],
    })
    expect(paths).toEqual([manifestPluginRoot, explicitPluginRoot])

    const snapshot = readWorkspacePluginPackagePiSnapshot(paths)
    expect(snapshot.additionalSkillPaths).toContain(join(manifestPluginRoot, "skills"))
    expect(snapshot.packages).toContain("npm:manifest-pi")
    expect(snapshot.extensionPaths).toContain(join(explicitPluginRoot, "agent", "index.ts"))
  })

  test("Pi snapshot keeps valid plugin resources when another plugin has preflight errors", async () => {
    const workspaceRoot = await makeTempDir("boring-pi-snapshot-partial-")
    const validRoot = join(workspaceRoot, "valid")
    const invalidRoot = join(workspaceRoot, "invalid")
    await mkdir(join(validRoot, "skills"), { recursive: true })
    await mkdir(join(validRoot, "agent"), { recursive: true })
    await writeFile(join(validRoot, "agent", "index.ts"), "export default function() {}\n", "utf8")
    await writeFile(join(validRoot, "package.json"), JSON.stringify({
      name: "valid-snapshot-plugin",
      pi: {
        systemPrompt: "VALID_SNAPSHOT_PROMPT",
        skills: ["skills"],
        extensions: ["agent/index.ts"],
        packages: ["npm:valid-snapshot-pi"],
      },
    }), "utf8")
    await mkdir(invalidRoot, { recursive: true })
    await writeFile(join(invalidRoot, "package.json"), JSON.stringify({
      name: "invalid-snapshot-plugin",
      boring: { front: "front/missing.tsx" },
    }), "utf8")

    const snapshot = readWorkspacePluginPackagePiSnapshot([validRoot, invalidRoot])
    expect(snapshot.additionalSkillPaths).toContain(join(validRoot, "skills"))
    expect(snapshot.extensionPaths).toContain(join(validRoot, "agent", "index.ts"))
    expect(snapshot.packages).toContain("npm:valid-snapshot-pi")
    expect(snapshot.systemPromptAppend).toContain("VALID_SNAPSHOT_PROMPT")
  })
})

describe("createWorkspaceAgentServer plugin runtime options", () => {
  test("getHotReloadableResources reflects current package.json#pi entries", async () => {
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
          getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] }
        }
      },
    ]
    // Static fields hold only host/workspace contributions, not package.json discoveries.
    expect(agentOptions.pi?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    // Dynamic getter holds the package.json-discovered values; Pi merges them.
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )

    await writeHotPlugin(workspaceRoot, "two.ts")
    await agentOptions.beforeReload?.()

    const refreshed = agentOptions.pi?.getHotReloadableResources?.()
    expect(refreshed?.extensionPaths).not.toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"))
    expect(refreshed?.extensionPaths).toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "two.ts"))
  })

  test("pluginHotReload=false uses boot-time package Pi snapshot without dynamic refresh", async () => {
    // The previous boringPluginReload + piPluginReload pair collapsed
    // to a single pluginHotReload flag (DESIGN.md §4.7) because the
    // useful matrix had only two states.
    const workspaceRoot = await makeTempDir("boring-workspace-plugin-hotreload-off-")
    await writeHotPlugin(workspaceRoot, "one.ts")
    const beforeReload = vi.fn(async () => {})

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      pluginHotReload: false,
      pi: {
        extensionPaths: [join(workspaceRoot, "host-extension.ts")],
        additionalSkillPaths: [join(workspaceRoot, "host-skills")],
      },
      beforeReload,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        pi?: { extensionPaths?: string[]; additionalSkillPaths?: string[]; extensionFactories?: unknown[]; getHotReloadableResources?: unknown }
        systemPromptDynamic?: unknown
        beforeReload?: () => Promise<void>
      },
    ]
    // Host pi options preserved and boot-time package.json#pi entries are merged statically.
    expect(agentOptions.pi?.extensionPaths).toEqual([
      join(workspaceRoot, "host-extension.ts"),
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "one.ts"),
    ])
    expect(agentOptions.pi?.additionalSkillPaths).toContain(join(workspaceRoot, "host-skills"))
    expect(agentOptions.pi?.additionalSkillPaths).toContain(join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"))
    // Dynamic Pi refresh disabled.
    expect(agentOptions.pi?.getHotReloadableResources).toBeUndefined()
    expect(agentOptions.systemPromptDynamic).toBeUndefined()
    // beforeReload still calls user's hook; just skips scan + rebuild.
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
      { pi?: { packages?: unknown[]; getHotReloadableResources?: () => { packages?: unknown[] } } },
    ]
    // pi.packages is the STATIC set: bundled @hachej/boring-pi skill +
    // host-supplied + factory-plugin entries. The bundled skill is added
    // when @hachej/boring-pi is resolvable from the workspace.
    expect(agentOptions.pi?.packages ?? []).toContainEqual(
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    )
    // The package.json#pi.packages discovered for the test plugin live in
    // getHotReloadableResources() so hot reload can re-read them.
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual([
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

  test("getHotReloadableResources reflects package.json#pi changes between calls", async () => {
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
      { pi?: { getHotReloadableResources?: () => { packages?: unknown[] } } },
    ]
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual(["npm:initial"])

    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "dyn-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { packages: ["npm:updated"] },
    }), "utf8")
    expect(agentOptions.pi?.getHotReloadableResources?.().packages).toEqual(["npm:updated"])
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

  test("defaultPluginPackages with pluginHotReload=false contribute static Pi resources and prompt", async () => {
    const appRoot = await makeTempDir("boring-default-package-static-pi-")
    const pluginRoot = join(appRoot, "plugins", "static-foo")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "skills"), { recursive: true })
    await mkdir(join(pluginRoot, "agent"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Foo() { return null }\n", "utf8")
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function extension() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "static-foo",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: {
        systemPrompt: "STATIC_FOO_PROMPT",
        skills: ["skills"],
        extensions: ["agent/index.ts"],
        packages: ["npm:static-foo-pi"],
      },
    }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      defaultPluginPackages: [pluginRoot],
      pluginHotReload: false,
      logger: false,
      provisionWorkspace: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        pi?: {
          additionalSkillPaths?: string[]
          extensionPaths?: string[]
          packages?: unknown[]
          getHotReloadableResources?: unknown
        }
        systemPromptAppend?: string
        systemPromptDynamic?: unknown
      },
    ]
    expect(agentOptions.pi?.getHotReloadableResources).toBeUndefined()
    expect(agentOptions.systemPromptDynamic).toBeUndefined()
    expect(agentOptions.pi?.additionalSkillPaths).toContain(join(pluginRoot, "skills"))
    expect(agentOptions.pi?.extensionPaths).toContain(join(pluginRoot, "agent", "index.ts"))
    expect(agentOptions.pi?.packages).toContain("npm:static-foo-pi")
    expect(agentOptions.systemPromptAppend).toContain("STATIC_FOO_PROMPT")
  })

  test("app package boring.defaultPluginPackages discovers front/Pi-only packages without server import", async () => {
    const appRoot = await makeTempDir("boring-app-default-package-")
    const pluginRoot = join(appRoot, "plugins", "foo")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "skills"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Foo() { return null }\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "foo",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { systemPrompt: "FOO_PLUGIN_PROMPT", skills: ["skills"] },
    }), "utf8")
    const appPackageJsonPath = join(appRoot, "package.json")
    await writeFile(appPackageJsonPath, JSON.stringify({
      name: "temp-app",
      boring: { defaultPluginPackages: ["./plugins/foo"] },
    }), "utf8")

    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      appPackageJsonPath,
      logger: false,
      provisionWorkspace: false,
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "foo",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          pi: expect.objectContaining({ systemPrompt: "FOO_PLUGIN_PROMPT" }),
        }),
      ])

      const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
          systemPromptAppend?: string
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "skills"))
      expect(agentOptions.systemPromptDynamic?.()).toContain("FOO_PLUGIN_PROMPT")
      expect(agentOptions.systemPromptAppend).not.toContain("FOO_PLUGIN_PROMPT")
    } finally {
      await app.close()
    }
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

  test("dir entry with async factory export is awaited and validated", async () => {
    const dir = await makeTempDir("phase1-dir-async-factory-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      `export default async function (options, ctx) {
         await Promise.resolve()
         return { id: "dir-async-factory", systemPrompt: "ASYNC ROOT=" + ctx.workspaceRoot }
       }`,
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "async-plugin" }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase1-async-host",
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("ASYNC ROOT=/tmp/phase1-async-host")
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
  test("editing a dir-source plugin's server entry re-resolves without diagnostics after /reload", async () => {
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

    // The exposed rebuild closure is diagnostic-only; a successful
    // re-resolve reports no diagnostics but does not return/install a graph.
    const rebuilt = await (app as unknown as { __boringRebuildPlugins: () => Promise<{ ok: boolean; diagnostics: unknown[] }> }).__boringRebuildPlugins()
    expect(rebuilt).toEqual({ ok: true, diagnostics: [] })
  })

  test("beforeReload returns rebuild diagnostics merged with caller restart warnings", async () => {
    const dir = await makeTempDir("phase5-diagnostics-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'diagnostic-plugin', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "diagnostic-plugin" }), "utf8")

    await createWorkspaceAgentServer({
      workspaceRoot: await makeTempDir("phase5-diagnostics-host-"),
      logger: false,
      provisionWorkspace: false,
      plugins: [{ dir, hotReload: true }],
      beforeReload: async () => ({
        restart_warnings: [
          { id: "caller-plugin", surfaces: ["routes"], message: "caller restart warning" },
        ],
      }),
    })

    await writeFile(join(dir, "src", "server", "index.ts"), "this is not valid typescript {{", "utf8")

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { beforeReload?: () => Promise<{ restart_warnings?: unknown[]; diagnostics?: unknown[] } | undefined> },
    ]
    const result = await agentOptions.beforeReload?.()
    expect(result?.restart_warnings).toEqual([
      expect.objectContaining({ id: "caller-plugin", surfaces: ["routes"] }),
    ])
    expect(result?.diagnostics?.length).toBeGreaterThan(0)
  })

  test("dir-source plugin re-resolve failure is tolerated; beforeReload does NOT throw (DESIGN.md §4.5 partial-failure tolerance)", async () => {
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
    // Per-plugin rebuild failures must NOT abort the reload — diagnostics
    // surface via SSE error events + .error files, not by aborting beforeReload.
    await expect(agentOptions.beforeReload?.()).resolves.not.toThrow()
  })
})
