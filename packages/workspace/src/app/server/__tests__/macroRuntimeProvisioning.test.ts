import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  provisionWorkspaceRuntime,
  type ProvisionWorkspaceRuntimeOptions,
  type WorkspaceProvisioningAdapter,
  type WorkspaceProvisioningExecResult,
} from "@hachej/boring-agent/server"
import { getBoringAgentRuntimePaths } from "@hachej/boring-sandbox/providers/node-workspace"

import {
  readWorkspacePluginPackagePiSnapshot,
  readWorkspacePluginPackageRuntimePlugins,
} from "../createWorkspaceAgentServer"
import { bootstrapServer, defineServerPlugin } from "../../../server/plugins/bootstrapServer"
import { sandboxRuntimeHostOperations } from '../sandboxRuntimeHost'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function treeSummary(root: string, dir = root, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = join(prefix, entry.name)
    out.push(entry.isDirectory() ? `${rel}/` : rel)
    if (entry.isDirectory()) out.push(...await treeSummary(root, join(dir, entry.name), rel))
  }
  return out
}

async function createMacroPackage(): Promise<{ root: string; pyproject: string; template: string }> {
  const root = await tempDir("boring-macro-package-")
  const skillsRoot = join(root, "src", "plugins", "macro", "server", "workspace-template", ".agents", "skills")
  await mkdir(join(skillsRoot, "macro-transform"), { recursive: true })
  await mkdir(join(skillsRoot, "macro-deck"), { recursive: true })
  await writeFile(join(skillsRoot, "macro-transform", "SKILL.md"), "# Macro transform\n")
  await writeFile(join(skillsRoot, "macro-deck", "SKILL.md"), "# Macro deck\n")
  const template = join(root, "src", "plugins", "macro", "server", "workspace-template")
  await mkdir(join(template, "deck"), { recursive: true })
  await mkdir(join(template, "transforms", "custom"), { recursive: true })
  await writeFile(join(template, "deck", "intro.md"), "# Intro\n")
  await writeFile(join(template, "transforms", "custom", ".gitkeep"), "")
  const sdk = join(root, "src", "plugins", "macro", "server", "sdk")
  await mkdir(sdk, { recursive: true })
  const pyproject = join(sdk, "pyproject.toml")
  await writeFile(pyproject, "[project]\nname = \"boring-macro-sdk\"\n[project.scripts]\nbm = \"boring_macro:main\"\n")
  await mkdir(join(root, "src", "plugins", "macro", "front"), { recursive: true })
  await writeFile(join(root, "src", "plugins", "macro", "front", "index.tsx"), 'export default definePlugin({ id: "boring-macro" })\n')
  await writeFile(join(root, "src", "plugins", "macro", "server", "index.ts"), "export default {}\n")
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "@boring/macro",
    version: "0.2.0",
    keywords: ["pi-package"],
    pi: {
      skills: [
        "src/plugins/macro/server/workspace-template/.agents/skills/macro-transform",
        "src/plugins/macro/server/workspace-template/.agents/skills/macro-deck",
      ],
      systemPrompt: "Use macro_search, macro catalog surfaces, and the bm CLI for reusable derived-series transforms.",
      packages: ["npm:pi-web-access"],
    },
    boring: {
      label: "Macro",
      front: "src/plugins/macro/front/index.tsx",
      server: "src/plugins/macro/server/index.ts",
    },
  }, null, 2))
  return { root, pyproject, template }
}

function mergeRuntimePlugins(
  plugins: ProvisionWorkspaceRuntimeOptions["plugins"],
): ProvisionWorkspaceRuntimeOptions["plugins"] {
  const byId = new Map<string, ProvisionWorkspaceRuntimeOptions["plugins"][number]>()
  for (const plugin of plugins) {
    const current = byId.get(plugin.id) ?? { id: plugin.id }
    byId.set(plugin.id, {
      id: plugin.id,
      skills: [...(current.skills ?? []), ...(plugin.skills ?? [])],
      provisioning: {
        templateDirs: [...(current.provisioning?.templateDirs ?? []), ...(plugin.provisioning?.templateDirs ?? [])],
        python: [...(current.provisioning?.python ?? []), ...(plugin.provisioning?.python ?? [])],
        nodePackages: [...(current.provisioning?.nodePackages ?? []), ...(plugin.provisioning?.nodePackages ?? [])],
      },
    })
  }
  return [...byId.values()]
}

function fakeAdapter(workspaceRoot: string, commands: Array<{ command: string; args: string[]; env?: Record<string, string> }>): WorkspaceProvisioningAdapter {
  const toAbs = (rel: string) => join(workspaceRoot, rel)
  return {
    mode: "direct",
    async exec(command, args, opts): Promise<WorkspaceProvisioningExecResult | void> {
      commands.push({ command, args, env: opts?.env })
      if (command === "python3" && args[0] === "--version") return { stdout: "Python 3.12.1\n" }
      if (command === "uv" && args[0] === "--version") return { stdout: "uv 0.5.0\n" }
      if (args[0] === "venv") {
        await mkdir(join(args[1], "bin"), { recursive: true })
        await writeFile(join(args[1], "bin", "python"), "#!/usr/bin/env python\n")
      }
      if (args[0] === "pip") {
        const pythonPath = args[args.indexOf("--python") + 1]
        await mkdir(dirname(pythonPath), { recursive: true })
        await writeFile(join(dirname(pythonPath), "bm"), "#!/usr/bin/env python\n")
      }
    },
    async resolveInstallSource(source) { return String(source) },
    workspaceFs: {
      async exists(rel) { try { await stat(toAbs(rel)); return true } catch { return false } },
      async rm(rel) { await rm(toAbs(rel), { recursive: true, force: true }) },
      async mkdir(rel) { await mkdir(toAbs(rel), { recursive: true }) },
      async writeText(rel, content) { await mkdir(dirname(toAbs(rel)), { recursive: true }); await writeFile(toAbs(rel), content) },
      async readText(rel) { try { return await readFile(toAbs(rel), "utf8") } catch { return null } },
      async copyFromHost(source, rel) {
        const sourcePath = source instanceof URL ? source.pathname : source
        const sourceStat = await stat(sourcePath)
        await mkdir(dirname(toAbs(rel)), { recursive: true })
        if (sourceStat.isDirectory()) {
          await cp(sourcePath, toAbs(rel), { recursive: true })
          return
        }
        await writeFile(toAbs(rel), await readFile(sourcePath))
      },
    },
    getRuntimeCacheRoot() { return join(workspaceRoot, ".boring-agent", "cache") },
  }
}

describe("macro package/runtime split", () => {
  test("package metadata owns Pi resources while trusted server plugin owns provisioning/routes/tools", async () => {
    const macro = await createMacroPackage()
    const workspaceRoot = await tempDir("boring-macro-workspace-")
    const homeRoot = await tempDir("boring-macro-home-")
    await mkdir(join(workspaceRoot, "deck"), { recursive: true })
    await writeFile(join(workspaceRoot, "deck", "intro.md"), "# User intro\n")
    const routes = vi.fn()
    const tool = { name: "macro_search", description: "Search", parameters: { type: "object" as const, properties: {} }, execute: vi.fn() }
    const serverPlugin = defineServerPlugin({
      id: "boring-macro",
      provisioning: {
        python: [{
          id: "macro-sdk",
          packageName: "boring-macro-sdk",
          projectFile: macro.pyproject,
          expectedBins: ["bm"],
          env: { BORING_MACRO_API_URL: "http://macro.local" },
        }],
        templateDirs: [{ id: "macro-template", path: macro.template }],
      },
      routes,
      agentTools: [tool],
    })

    const packageRuntimePlugins = readWorkspacePluginPackageRuntimePlugins([macro.root])
    const piSnapshot = readWorkspacePluginPackagePiSnapshot([macro.root])
    const boot = bootstrapServer({ plugins: [serverPlugin] })
    const runtimePlugins = mergeRuntimePlugins([...packageRuntimePlugins, ...boot.runtimePlugins])
    const paths = getBoringAgentRuntimePaths(workspaceRoot)
    const commands: Array<{ command: string; args: string[]; env?: Record<string, string> }> = []
    const oldHome = process.env.HOME
    const oldUserProfile = process.env.USERPROFILE
    process.env.HOME = homeRoot
    process.env.USERPROFILE = homeRoot
    let result: Awaited<ReturnType<typeof provisionWorkspaceRuntime>> | undefined
    try {
      result = await provisionWorkspaceRuntime({
        plugins: runtimePlugins,
        adapter: fakeAdapter(workspaceRoot, commands),
        runtimeLayout: paths,
        runtimeHost: sandboxRuntimeHostOperations,
      })
    } finally {
      process.env.HOME = oldHome
      process.env.USERPROFILE = oldUserProfile
    }

    expect(packageRuntimePlugins[0].skills?.map((skill) => skill.name)).toEqual(["macro-transform", "macro-deck"])
    expect(piSnapshot.systemPromptAppend).toContain("Use macro_search")
    expect(piSnapshot.packages).toEqual(["npm:pi-web-access"])
    expect(boot.routeContributions).toEqual([{ id: "boring-macro", routes }])
    expect(boot.agentTools).toEqual([tool])
    expect(runtimePlugins[0]).not.toHaveProperty("routes")
    expect(runtimePlugins[0]).not.toHaveProperty("agentTools")

    await expect(readFile(join(paths.skills, "boring-macro", "macro-transform", "SKILL.md"), "utf8")).resolves.toContain("Macro transform")
    await expect(readFile(join(paths.venvBin, "bm"), "utf8")).resolves.toContain("python")
    await expect(readFile(join(workspaceRoot, "deck", "intro.md"), "utf8")).resolves.toBe("# User intro\n")
    await expect(readFile(join(workspaceRoot, "transforms", "custom", ".gitkeep"), "utf8")).resolves.toBe("")
    expect(result).toBeDefined()
    const diagnostics = JSON.stringify({
      workspaceRoot,
      boringAgentTree: await treeSummary(join(workspaceRoot, ".boring-agent")),
      expectedPathEntries: result?.pathEntries,
      skillPaths: [join(paths.skills, "boring-macro", "macro-transform")],
      installCommands: commands,
    }, null, 2)
    expect(result?.env.BORING_MACRO_API_URL, diagnostics).toBe("http://macro.local")
    expect(result?.pathEntries, diagnostics).toContain(paths.venvBin)
    expect(commands.find((command) => command.args[0] === "pip")?.env?.BORING_MACRO_API_URL, diagnostics).toBe("http://macro.local")
    await expect(readFile(join(homeRoot, ".boring-agent", ".gitignore"), "utf8"), diagnostics).rejects.toThrow()
  })
})
