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
  provisionWorkspaceRuntime: vi.fn(async () => undefined),
}))

vi.mock("@hachej/boring-agent/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hachej/boring-agent/server")>()
  return {
    ...actual,
    createAgentApp: agentServerMock.createAgentApp,
    provisionRuntimeWorkspace: agentServerMock.provisionRuntimeWorkspace,
    provisionWorkspaceRuntime: agentServerMock.provisionWorkspaceRuntime,
  }
})

import {
  collectWorkspaceAgentServerPlugins,
  createWorkspaceAgentServer,
  readWorkspacePluginPackagePiSnapshot,
  resolveWorkspaceAgentServerPluginCollection,
} from "../createWorkspaceAgentServer"
import { resolveDefaultWorkspacePluginPackagePaths } from "../defaultPluginPackages"

const tempDirs: string[] = []

beforeEach(() => {
  agentServerMock.createAgentApp.mockClear()
  agentServerMock.provisionRuntimeWorkspace.mockClear()
  agentServerMock.provisionWorkspaceRuntime.mockClear()
})

function mockCreateAgentAppOnce(factory: (opts?: unknown) => Promise<unknown>): void {
  agentServerMock.createAgentApp.mockImplementationOnce(factory as never)
}

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
    const paths = resolveDefaultWorkspacePluginPackagePaths({
      workspaceRoot: appRoot,
      defaultPluginPackages: [manifestPluginRoot, explicitPluginRoot],
    })
    expect(paths).toEqual([manifestPluginRoot, explicitPluginRoot])

    const snapshot = readWorkspacePluginPackagePiSnapshot(paths)
    expect(snapshot.additionalSkillPaths).toContain(join(manifestPluginRoot, "skills"))
    expect(snapshot.packages).toContain("npm:manifest-pi")
    expect(snapshot.extensionPaths).toContain(join(explicitPluginRoot, "agent", "index.ts"))
  })

  test("Pi snapshot converts single-skill package paths into loader roots", async () => {
    const appRoot = await makeTempDir("boring-app-helper-single-skill-package-")
    const pluginRoot = join(appRoot, "plugins", "deck")
    await mkdir(join(pluginRoot, "skills", "deck-authoring"), { recursive: true })
    await writeFile(join(pluginRoot, "skills", "deck-authoring", "SKILL.md"), "# deck-authoring\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "deck",
      pi: { skills: ["skills/deck-authoring"] },
    }), "utf8")

    const snapshot = readWorkspacePluginPackagePiSnapshot([pluginRoot])

    expect(snapshot.additionalSkillPaths).toContain(join(pluginRoot, "skills"))
    expect(snapshot.additionalSkillPaths).not.toContain(join(pluginRoot, "skills", "deck-authoring"))
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

describe("default boring-ui CLI provisioning", () => {
  function findBoringUiCliContribution(contributions: Array<{ id: string; provisioning?: { nodePackages?: unknown[] } }>) {
    return contributions.find((entry) => entry.id === "boring-ui-plugin-cli-package")
  }

  test("collector exposes the CLI package through default/exclude mechanisms", async () => {
    const included = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-"),
      installPluginAuthoring: true,
    })
    const cli = findBoringUiCliContribution(included.provisioningContributions)
    expect(cli?.provisioning?.nodePackages).toContainEqual(expect.objectContaining({
      id: "boring-ui-plugin-cli",
      packageName: "@hachej/boring-ui-plugin-cli",
      expectedBins: ["boring-ui-plugin"],
    }))

    const excluded = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-excluded-"),
      excludeDefaults: ["boring-ui-plugin-cli-package"],
      installPluginAuthoring: true,
    })
    expect(findBoringUiCliContribution(excluded.provisioningContributions)).toBeUndefined()

    const disabled = collectWorkspaceAgentServerPlugins({
      workspaceRoot: await makeTempDir("boring-cli-default-disabled-"),
      installPluginAuthoring: false,
    })
    expect(findBoringUiCliContribution(disabled.provisioningContributions)).toBeUndefined()
  })

  test.each([
    { mode: "direct" as const, installPluginAuthoring: undefined, shouldProvisionCli: false, shouldPrompt: true },
    { mode: "local" as const, installPluginAuthoring: undefined, shouldProvisionCli: true, shouldPrompt: true },
    { mode: "local" as const, installPluginAuthoring: false, shouldProvisionCli: false, shouldPrompt: false },
  ])(
    "mode $mode handles default plugin CLI provisioning and prompt commands",
    async ({ mode, installPluginAuthoring, shouldProvisionCli, shouldPrompt }) => {
      const workspaceRoot = await makeTempDir(`boring-cli-${mode}-`)
      let capturedPrompt: string | undefined
      mockCreateAgentAppOnce(async (opts: unknown) => {
        const agentOpts = opts as {
          workspaceRoot: string
          systemPromptAppend?: string
          runtimeProvisioner?: (ctx: unknown) => Promise<void>
        }
        capturedPrompt = agentOpts.systemPromptAppend
        await agentOpts.runtimeProvisioner?.({
          workspaceRoot: agentOpts.workspaceRoot,
          runtimeMode: mode,
          runtimeBundle: {
            storageRoot: agentOpts.workspaceRoot,
            runtimeContext: { runtimeCwd: mode === "direct" ? agentOpts.workspaceRoot : "/workspace" },
            workspace: {},
            sandbox: {},
          },
        })
        return { register: vi.fn(async () => {}) } as never
      })

      await createWorkspaceAgentServer({
        workspaceRoot,
        mode,
        logger: false,
        ...(installPluginAuthoring === undefined ? {} : { installPluginAuthoring }),
      })

      expect(agentServerMock.provisionWorkspaceRuntime).toHaveBeenCalledTimes(1)
      const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
        { plugins: Array<{ id: string; provisioning?: { nodePackages?: unknown[] } }> },
      ]
      const cli = findBoringUiCliContribution(provisionOpts.plugins)
      if (shouldProvisionCli) {
        expect(cli?.provisioning?.nodePackages).toContainEqual(expect.objectContaining({
          id: "boring-ui-plugin-cli",
          packageName: "@hachej/boring-ui-plugin-cli",
          expectedBins: ["boring-ui-plugin"],
        }))
      } else {
        expect(cli).toBeUndefined()
      }
      if (shouldPrompt) {
        expect(capturedPrompt).toContain("boring-ui-plugin scaffold")
        expect(capturedPrompt).toContain("boring-ui-plugin verify")
      } else {
        expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
        expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
      }
    },
  )

  test("externalPlugins=false removes plugin CLI provisioning and prompt commands", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-external-disabled-")
    let capturedPrompt: string | undefined
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const agentOpts = opts as { externalPlugins?: boolean; systemPromptAppend?: string }
      expect(agentOpts.externalPlugins).toBe(false)
      capturedPrompt = agentOpts.systemPromptAppend
      return { register: vi.fn(async () => {}) } as never
    })

    await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "local",
      logger: false,
      externalPlugins: false,
    })

    const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
      { plugins: Array<{ id: string }> },
    ]
    expect(findBoringUiCliContribution(provisionOpts.plugins)).toBeUndefined()
    expect(capturedPrompt ?? "").toContain("does not expose Boring plugin creation or installation")
    expect(capturedPrompt ?? "").not.toContain("Generated plugin skills")
    expect(capturedPrompt ?? "").not.toContain("external plugin authoring")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
    expect(capturedPrompt ?? "").not.toContain("boring-plugin-authoring")
  })

  test("excludeDefaults removes built-in plugin CLI provisioning and prompt commands", async () => {
    const workspaceRoot = await makeTempDir("boring-cli-exclude-runtime-")
    let capturedPrompt: string | undefined
    mockCreateAgentAppOnce(async (opts: unknown) => {
      const agentOpts = opts as { systemPromptAppend?: string }
      capturedPrompt = agentOpts.systemPromptAppend
      return { register: vi.fn(async () => {}) } as never
    })

    await createWorkspaceAgentServer({
      workspaceRoot,
      mode: "direct",
      logger: false,
      excludeDefaults: ["boring-ui-plugin-cli-package"],
    })

    const [provisionOpts] = agentServerMock.provisionWorkspaceRuntime.mock.calls[0] as unknown as [
      { plugins: Array<{ id: string }> },
    ]
    expect(findBoringUiCliContribution(provisionOpts.plugins)).toBeUndefined()
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin scaffold")
    expect(capturedPrompt ?? "").not.toContain("boring-ui-plugin verify")
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

  test("externalPlugins=true keeps workspace .pi plugins hot-reloadable", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-external-enabled-")
    await writeHotPlugin(workspaceRoot, "visible.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: true,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        externalPlugins?: boolean
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
    expect(agentOptions.externalPlugins).toBe(true)
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "visible.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )
  })

  test("externalPlugins=false excludes workspace .pi plugins from hot-reloadable resources", async () => {
    const workspaceRoot = await makeTempDir("boring-workspace-external-disabled-")
    await writeHotPlugin(workspaceRoot, "hidden.ts")

    await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      externalPlugins: false,
    })

    const [agentOptions] = agentServerMock.createAgentApp.mock.calls[0] as unknown as [
      {
        externalPlugins?: boolean
        pi?: { getHotReloadableResources?: () => { extensionPaths?: string[]; additionalSkillPaths?: string[] } }
      },
    ]
    expect(agentOptions.externalPlugins).toBe(false)
    expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths ?? []).not.toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "hidden.ts"),
    )
    expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths ?? []).not.toContain(
      join(workspaceRoot, ".pi", "extensions", "hot-plugin", "agent", "skills"),
    )
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

  test("defaultPluginPackages discovers front/Pi-only packages without server import", async () => {
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
    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      defaultPluginPackages: [pluginRoot],
      logger: false,
      provisionWorkspace: false,
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
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

  test("workspace and agent-spec activation share one canonical resolver/load lifecycle without duplicate loading", async () => {
    const workspaceRoot = await makeTempDir("boring-one-machinery-workspace-")
    const pluginRoot = join(workspaceRoot, "plugins", "one-machinery")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "server"), { recursive: true })
    await mkdir(join(pluginRoot, "agent", "skills"), { recursive: true })
    await writeFile(
      join(pluginRoot, "front", "index.tsx"),
      'import { definePlugin } from "@hachej/boring-workspace/plugin"\nexport default definePlugin({ id: "one-machinery" })\n',
      "utf8",
    )
    await writeFile(
      join(pluginRoot, "server", "index.mjs"),
      `globalThis.__boringOneMachineryLoads = (globalThis.__boringOneMachineryLoads ?? 0) + 1\nexport default { id: "one-machinery", systemPrompt: "ONE_MACHINERY_SERVER" }\n`,
      "utf8",
    )
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "legacy-package-name",
      version: "1.0.0",
      boring: { id: "one-machinery", front: "front/index.tsx", server: "server/index.mjs" },
      pi: { systemPrompt: "ONE_MACHINERY_PI", skills: ["agent/skills"] },
    }), "utf8")

    ;(globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads = 0
    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      defaultPluginPackages: [pluginRoot],
      plugins: [{ dir: pluginRoot, hotReload: true }],
    })

    try {
      expect((globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads).toBe(1)
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "one-machinery",
          boring: expect.objectContaining({ id: "one-machinery", front: "front/index.tsx" }),
          pi: expect.objectContaining({ systemPrompt: "ONE_MACHINERY_PI" }),
        }),
      ])

      const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[] } }
          systemPromptAppend?: string
          systemPromptDynamic?: () => string | undefined
        },
      ]
      expect(agentOptions.systemPromptAppend).toContain("ONE_MACHINERY_SERVER")
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "agent", "skills"))
      expect(agentOptions.systemPromptDynamic?.()).toContain("ONE_MACHINERY_PI")
    } finally {
      await app.close()
      delete (globalThis as { __boringOneMachineryLoads?: number }).__boringOneMachineryLoads
    }
  })

  test("trusted host capabilities are passed only to internal directory plugins", async () => {
    const workspaceRoot = await makeTempDir("boring-trusted-plugin-context-")
    const internalRoot = join(workspaceRoot, "internal")
    const externalRoot = join(workspaceRoot, "external")
    for (const [root, id] of [[internalRoot, "internal-plugin"], [externalRoot, "external-plugin"]] as const) {
      await mkdir(join(root, "server"), { recursive: true })
      await writeFile(
        join(root, "server", "index.mjs"),
        `export default (_options, ctx) => ({ id: ${JSON.stringify(id)}, systemPrompt: ctx?.trusted ? ${JSON.stringify(`${id}:trusted`)} : ${JSON.stringify(`${id}:untrusted`)} })\n`,
        "utf8",
      )
      await writeFile(join(root, "package.json"), JSON.stringify({ name: id, boring: { server: "server/index.mjs" } }), "utf8")
    }

    const collection = await resolveWorkspaceAgentServerPluginCollection({
      workspaceRoot,
      bridge: {} as never,
      defaultPluginPackages: [internalRoot],
      plugins: [{ dir: externalRoot, hotReload: true }],
      trustedPluginContext: {
        workspaceAgentDispatcherResolver: { resolve: vi.fn() } as never,
        actorResolver: vi.fn(async () => ({ workspaceId: "default", userId: "local" })),
      },
    })

    expect(collection.agentOptions.systemPromptAppend).toContain("internal-plugin:trusted")
    expect(collection.agentOptions.systemPromptAppend).toContain("external-plugin:untrusted")
  })

  test("additionalBoringPluginDirs discovers front/Pi-only plugins from an extra global root", async () => {
    const workspaceRoot = await makeTempDir("boring-extra-plugin-root-workspace-")
    const globalRoot = await makeTempDir("boring-extra-plugin-root-global-")
    const pluginRoot = join(globalRoot, "global-plugin")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await mkdir(join(pluginRoot, "agent", "skills"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function GlobalPlugin() { return null }\n", "utf8")
    await writeFile(join(pluginRoot, "agent", "index.ts"), "export default function extension() {}\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "global-plugin",
      version: "1.0.0",
      boring: { front: "front/index.tsx" },
      pi: { systemPrompt: "GLOBAL_PLUGIN_PROMPT", skills: ["agent/skills"], extensions: ["agent/index.ts"] },
    }), "utf8")

    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      additionalBoringPluginDirs: [globalRoot],
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "global-plugin",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          pi: expect.objectContaining({ systemPrompt: "GLOBAL_PLUGIN_PROMPT" }),
        }),
      ])

      const [agentOptions] = agentServerMock.createAgentApp.mock.calls.at(-1) as unknown as [
        {
          pi?: { getHotReloadableResources?: () => { additionalSkillPaths?: string[]; extensionPaths?: string[] } }
          systemPromptDynamic?: () => string | undefined
        },
      ]
      expect(agentOptions.pi?.getHotReloadableResources?.().additionalSkillPaths).toContain(join(pluginRoot, "agent", "skills"))
      expect(agentOptions.pi?.getHotReloadableResources?.().extensionPaths).toContain(join(pluginRoot, "agent", "index.ts"))
      expect(agentOptions.systemPromptDynamic?.()).toContain("GLOBAL_PLUGIN_PROMPT")
    } finally {
      await app.close()
    }
  })

  test("boringPluginFrontTargetResolver customizes plugin list payloads without changing discovery", async () => {
    const workspaceRoot = await makeTempDir("boring-front-target-resolver-workspace-")
    await writeHotPlugin(workspaceRoot, "index.ts")

    agentServerMock.createAgentApp.mockImplementationOnce(async () => Fastify({ logger: false }) as never)
    const app = await createWorkspaceAgentServer({
      workspaceRoot,
      logger: false,
      provisionWorkspace: false,
      boringPluginFrontTargetResolver(plugin, { revision, frontEntrySubpath }) {
        return {
          kind: "native",
          entryUrl: `/runtime/${plugin.id}/${revision}/${frontEntrySubpath}`,
          revision,
          trust: "local-trusted-native",
        }
      },
    })

    try {
      const list = await app.inject({ method: "GET", url: "/api/v1/agent-plugins" })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toEqual([
        expect.objectContaining({
          id: "hot-plugin",
          boring: expect.objectContaining({ front: "front/index.tsx" }),
          frontTarget: {
            kind: "native",
            entryUrl: "/runtime/hot-plugin/1/front/index.tsx",
            revision: 1,
            trust: "local-trusted-native",
          },
        }),
      ])
    } finally {
      await app.close()
    }
  })

  test("defaultPluginPackages throws when declared server entry is missing", async () => {
    const appRoot = await makeTempDir("boring-app-default-package-missing-server-")
    const pluginRoot = join(appRoot, "plugins", "bad")
    await mkdir(join(pluginRoot, "front"), { recursive: true })
    await writeFile(join(pluginRoot, "front", "index.tsx"), "export default function Bad() { return null }\n", "utf8")
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
      name: "bad",
      version: "1.0.0",
      boring: { front: "front/index.tsx", server: "server/missing.ts" },
    }), "utf8")
    await expect(createWorkspaceAgentServer({
      workspaceRoot: appRoot,
      defaultPluginPackages: [pluginRoot],
      logger: false,
      provisionWorkspace: false,
    })).rejects.toThrow(/declared but not found/)
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
    const pkg: Record<string, unknown> = { name: "test-plugin", boring: { id: opts.factory ? "dir-factory" : "dir-object", server: serverRel } }
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
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "async-plugin", boring: { id: "dir-async-factory", server: "src/server/index.ts" } }), "utf8")

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
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p5", boring: { server: "src/server/index.ts" } }), "utf8")

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
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "diagnostic-plugin", boring: { server: "src/server/index.ts" } }), "utf8")

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

  test("dir-source plugin re-resolve failure is tolerated; beforeReload does NOT throw (PLUGIN_SYSTEM.md §4.5 partial-failure tolerance)", async () => {
    const dir = await makeTempDir("phase5-bad-")
    await mkdir(join(dir, "src", "server"), { recursive: true })
    await writeFile(
      join(dir, "src", "server", "index.ts"),
      "export default { id: 'good', systemPrompt: 'OK' }",
      "utf8",
    )
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "p", boring: { id: "good", server: "src/server/index.ts" } }), "utf8")

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
