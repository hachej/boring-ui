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
    expect(agentOptions.pi?.packages).toEqual([
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
    ])
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
    expect(agentOptions.pi?.packages).toEqual([
      expect.objectContaining({ skills: ["skills/boring-plugin-authoring"] }),
      {
        source: "npm:plugin-pi",
        extensions: ["./a.ts", "./b.ts"],
      },
      "npm:host-pi",
    ])
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

  test("plugins[] accepts both pre-built objects and factory functions", async () => {
    const builtPlugin = { id: "built", systemPrompt: "BUILT" }
    const factoryFn = vi.fn(() => ({ id: "fromfactory", systemPrompt: "FACTORY" }))

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase0-mixed-entries",
      logger: false,
      provisionWorkspace: false,
      plugins: [builtPlugin, factoryFn],
    })

    expect(factoryFn).toHaveBeenCalledTimes(1)
    expect(factoryFn).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: "/tmp/phase0-mixed-entries", bridge: expect.anything() }),
    )

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("BUILT")
    expect(agentOptions.systemPromptAppend).toContain("FACTORY")
  })

  test("pluginFactories alias still works (back-compat)", async () => {
    const factoryFn = vi.fn(() => ({ id: "legacy", systemPrompt: "LEGACY" }))

    await createWorkspaceAgentServer({
      workspaceRoot: "/tmp/phase0-legacy-alias",
      logger: false,
      provisionWorkspace: false,
      pluginFactories: [factoryFn],
    })

    expect(factoryFn).toHaveBeenCalledTimes(1)
    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      { systemPromptAppend?: string },
    ]
    expect(agentOptions.systemPromptAppend).toContain("LEGACY")
  })
})
