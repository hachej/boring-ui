import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { afterEach, expect, test } from "vitest"

const execFileAsync = promisify(execFile)
const distBin = resolve("dist", "bin.js")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function packPackage(packageDir: string, packDir: string): Promise<string> {
  const packed = await execFileAsync("pnpm", ["pack", "--pack-destination", packDir], { cwd: resolve(packageDir) })
  const tarball = packed.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
  if (!tarball) throw new Error(`pnpm pack did not print a tarball path for ${packageDir}`)
  return tarball
}

test("packed plugin CLI owns boring-ui-plugin and supports plugin commands", async () => {
  const root = await tempDir("boring-plugin-cli-")
  const packDir = join(root, "packs")
  const installRoot = join(root, "install")
  const workspaceRoot = join(root, "workspace")
  await mkdir(packDir, { recursive: true })

  const cliTarball = await packPackage(".", packDir)

  await execFileAsync("npm", [
    "install",
    "--prefix", installRoot,
    "--ignore-scripts",
    "--no-audit",
    "--package-lock=false",
    cliTarball,
  ], { maxBuffer: 10 * 1024 * 1024 })

  const bin = join(installRoot, "node_modules", ".bin", "boring-ui-plugin")
  await expect(access(bin)).resolves.toBeUndefined()
  await expect(access(join(installRoot, "node_modules", ".bin", "boring-ui"))).rejects.toThrow()
  await expect(readFile(join(installRoot, "node_modules", "@hachej", "boring-ui-plugin-cli", "package.json"), "utf8"))
    .resolves.toContain("@hachej/boring-ui-plugin-cli")
  await expect(access(join(installRoot, "node_modules", "@hachej", "boring-ui-cli"))).rejects.toThrow()
  await expect(access(join(installRoot, "node_modules", "@hachej", "boring-plugin-contract"))).rejects.toThrow()
  await expect(access(join(installRoot, "node_modules", "@hachej", "boring-plugin-tools"))).rejects.toThrow()

  const status = await execFileAsync(bin, ["status", "--json"], { cwd: installRoot })
  expect(JSON.parse(status.stdout)).toMatchObject({ workspaceLocalPluginRoots: true })

  const create = await execFileAsync(bin, ["create", "tiny-package", "--path", "plugins"], { cwd: installRoot })
  expect(create.stdout).toContain("created tiny-package")
  const packagePlugin = JSON.parse(await readFile(join(installRoot, "plugins", "tiny-package", "package.json"), "utf8")) as { name: string }
  expect(packagePlugin.name).toBe("@hachej/boring-tiny-package")

  await expect(execFileAsync(bin, ["create", "../escape", "--path", "plugins"], { cwd: installRoot }))
    .rejects.toMatchObject({ stderr: expect.stringContaining("must be kebab-case") })
  await expect(access(join(installRoot, "escape"))).rejects.toThrow()

  const scaffold = await execFileAsync(bin, ["scaffold", "tiny-runtime", workspaceRoot], { cwd: installRoot })
  expect(scaffold.stdout).toContain("scaffolded tiny-runtime")

  const verify = await execFileAsync(bin, ["verify", "tiny-runtime", workspaceRoot], { cwd: installRoot })
  expect(verify.stdout).toContain("OK — 1 plugin")
})

async function writeRuntimePlugin(dir: string, name: string, deps: Record<string, string> = {}): Promise<void> {
  await mkdir(join(dir, "front"), { recursive: true })
  await writeFile(join(dir, "front", "index.tsx"), "export default function Plugin() { return null }\n", "utf8")
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    boring: { front: "front/index.tsx" },
    ...(Object.keys(deps).length > 0 ? { dependencies: deps } : {}),
  }, null, 2), "utf8")
}

async function runPluginCli(args: string[], opts: { cwd: string; env?: Record<string, string> }) {
  return await execFileAsync(process.execPath, [distBin, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}), NO_COLOR: "1" },
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function readPiSettingsPackages(settingsPath: string): Promise<string[]> {
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { packages?: unknown[] }
  return (settings.packages ?? []).flatMap((entry) => typeof entry === "string" ? [entry] : [])
}

test("boring-ui-plugin install/list/remove defaults to workspace-local Pi settings without the main CLI", async () => {
  const root = await tempDir("boring-plugin-source-local-")
  const workspaceRoot = join(root, "workspace")
  const source = join(root, "source-plugin")
  await mkdir(workspaceRoot, { recursive: true })
  await writeRuntimePlugin(source, "local-plugin", { recharts: "^2.0.0" })

  const install = await runPluginCli(["install", source], { cwd: workspaceRoot })
  expect(install.stdout).toContain("installed local-plugin")
  expect(install.stdout).toContain("scope local")
  expect(install.stdout).toContain(`dir   ${resolve(source)}`)
  expect(install.stdout).toContain("Missing dependency: recharts")
  expect(install.stdout).toContain(`Run: cd ${resolve(source)} && npm install`)
  await expect(access(join(workspaceRoot, ".pi", "extensions", "local-plugin"))).rejects.toThrow()

  await expect(access(join(workspaceRoot, ".pi", "boring-plugin-sources.json"))).rejects.toThrow()
  expect(await readPiSettingsPackages(join(workspaceRoot, ".pi", "settings.json"))).toEqual([resolve(source)])

  const list = await runPluginCli(["list", "--json"], { cwd: workspaceRoot })
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({ id: "local-plugin", scope: "local" })])

  const remove = await runPluginCli(["remove", "local-plugin"], { cwd: workspaceRoot })
  expect(remove.stdout).toContain("removed local-plugin")
  await expect(access(join(source, "package.json"))).resolves.toBeUndefined()
  const emptyList = await runPluginCli(["list"], { cwd: workspaceRoot })
  expect(emptyList.stdout).toContain("No plugins installed in local scope")
  await expect(runPluginCli(["remove", "local-plugin"], { cwd: workspaceRoot })).rejects.toMatchObject({
    stderr: expect.stringContaining("plugin source not found in local scope: local-plugin"),
  })
})

test("boring-ui-plugin local installs inside the workspace persist workspace-relative path metadata", async () => {
  const root = await tempDir("boring-plugin-source-relative-")
  const workspaceRoot = join(root, "workspace")
  const source = join(workspaceRoot, "plugins", "relative-plugin")
  await mkdir(workspaceRoot, { recursive: true })
  await writeRuntimePlugin(source, "relative-plugin")

  const install = await runPluginCli(["install", "plugins/relative-plugin"], { cwd: workspaceRoot })
  expect(install.stdout).toContain("installed relative-plugin")

  await expect(access(join(workspaceRoot, ".pi", "boring-plugin-sources.json"))).rejects.toThrow()
  expect(await readPiSettingsPackages(join(workspaceRoot, ".pi", "settings.json"))).toEqual(["../plugins/relative-plugin"])
})

test("boring-ui-plugin list resolves Pi settings paths relative to the settings file", async () => {
  const root = await tempDir("boring-plugin-source-settings-relative-")
  const workspaceRoot = join(root, "host-workspace")
  const pluginRoot = join(workspaceRoot, "plugins", "settings-plugin")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeRuntimePlugin(pluginRoot, "settings-plugin")
  await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
    packages: ["../plugins/settings-plugin"],
  }), "utf8")

  const list = await runPluginCli(["list", "--json"], { cwd: workspaceRoot })
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({
    id: "settings-plugin",
    scope: "local",
    packageSource: "../plugins/settings-plugin",
    source: resolve(pluginRoot),
    rootDir: resolve(pluginRoot),
  })])
})

test("boring-ui-plugin list resolves file: Pi package sources", async () => {
  const root = await tempDir("boring-plugin-source-file-prefix-")
  const workspaceRoot = join(root, "host-workspace")
  const pluginRoot = join(workspaceRoot, "plugins", "file-plugin")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeRuntimePlugin(pluginRoot, "file-plugin")
  await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
    packages: ["file:../plugins/file-plugin"],
  }), "utf8")

  const list = await runPluginCli(["list", "--json"], { cwd: workspaceRoot })
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({
    id: "file-plugin",
    packageSource: "file:../plugins/file-plugin",
    rootDir: resolve(pluginRoot),
  })])
})

test("boring-ui-plugin list ignores uninspectable Pi package sources", async () => {
  const root = await tempDir("boring-plugin-source-uninspectable-")
  const workspaceRoot = join(root, "host-workspace")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
    packages: ["../missing", "npm:not-installed-yet"],
  }), "utf8")

  const list = await runPluginCli(["list", "--json"], { cwd: workspaceRoot })
  expect(JSON.parse(list.stdout).records).toEqual([])
})

test("resolveRegisteredPluginSourceDirs keeps broken local entries and skips remote specs", async () => {
  const { resolvePluginSourceScopePaths, resolveRegisteredPluginSourceDirs } = await import("../index")
  const root = await tempDir("boring-plugin-registered-dirs-")
  const workspaceRoot = join(root, "host-workspace")
  const validPlugin = join(workspaceRoot, "plugins", "valid-plugin")
  await mkdir(join(workspaceRoot, ".pi"), { recursive: true })
  await writeRuntimePlugin(validPlugin, "valid-plugin")
  await writeFile(join(workspaceRoot, ".pi", "settings.json"), JSON.stringify({
    packages: ["../plugins/valid-plugin", "../plugins/deleted-plugin", "npm:not-installed-yet"],
  }), "utf8")

  const scope = resolvePluginSourceScopePaths("local", { workspaceRoot })
  expect(resolveRegisteredPluginSourceDirs(scope)).toEqual([
    { source: "../plugins/valid-plugin", rootDir: resolve(validPlugin) },
    { source: "../plugins/deleted-plugin", rootDir: resolve(workspaceRoot, "plugins", "deleted-plugin") },
  ])
})

async function writeLocalDependency(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }, null, 2), "utf8")
  await writeFile(join(dir, "index.js"), "module.exports = {}\n", "utf8")
}

test("boring-ui-plugin installs git and npm plugin sources with their declared dependencies", async () => {
  const root = await tempDir("boring-plugin-source-remote-")
  const workspaceRoot = join(root, "workspace")
  const gitSource = join(root, "git-source")
  const npmSource = join(root, "npm-source")
  // A real, network-free dependency referenced by absolute file: spec so the
  // install resolves it offline and after the package is relocated into .pi.
  const dependency = join(root, "dep-pkg")
  await mkdir(workspaceRoot, { recursive: true })
  // npm materializes a file: dependency as a *relative* symlink even from an
  // absolute spec, so this also guards the "install at the final path, not in
  // staging" rationale: installing in staging then moving would leave the
  // symlink dangling and these assertions would fail.
  await writeLocalDependency(dependency, "boring-source-dep")
  // `react` is host-provided: it must be stripped before install (never fetched,
  // never shadowed), while the real file: dependency is installed.
  await writeRuntimePlugin(gitSource, "git-plugin", { "boring-source-dep": `file:${dependency}`, react: "^18.0.0" })
  await writeRuntimePlugin(npmSource, "npm-plugin", { "boring-source-dep": `file:${dependency}`, react: "^18.0.0" })

  await execFileAsync("git", ["init"], { cwd: gitSource })
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: gitSource })
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: gitSource })
  await execFileAsync("git", ["add", "."], { cwd: gitSource })
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: gitSource })

  const gitInstall = await runPluginCli(["install", `git:${gitSource}`, "--workspace", workspaceRoot], { cwd: root })
  expect(gitInstall.stderr).toContain("Security: Boring plugins run as trusted local code")
  expect(gitInstall.stdout).toContain("installed git-plugin")
  expect(gitInstall.stdout).not.toContain("Missing dependency")
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin", "package.json"))).resolves.toBeUndefined()
  // Dependencies are installed into the cloned package's own node_modules, like Pi.
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin", "node_modules", "boring-source-dep", "package.json"))).resolves.toBeUndefined()
  // Host-provided react is stripped, never shadowed into the plugin tree.
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin", "node_modules", "react"))).rejects.toThrow()

  const npmInstall = await runPluginCli(["install", `npm:${npmSource}`, "--workspace", workspaceRoot], { cwd: root })
  expect(npmInstall.stderr).toContain("Security: Boring plugins run as trusted local code")
  expect(npmInstall.stdout).toContain("installed npm-plugin")
  expect(npmInstall.stdout).not.toContain("Missing dependency")
  await expect(access(join(workspaceRoot, ".pi", "npm", "npm-plugin", "package.json"))).resolves.toBeUndefined()
  await expect(access(join(workspaceRoot, ".pi", "npm", "npm-plugin", "node_modules", "boring-source-dep", "package.json"))).resolves.toBeUndefined()
  await expect(access(join(workspaceRoot, ".pi", "npm", "npm-plugin", "node_modules", "react"))).rejects.toThrow()

  expect(await readPiSettingsPackages(join(workspaceRoot, ".pi", "settings.json"))).toEqual([
    "./git/git-plugin",
    "./npm/npm-plugin",
  ])

  const list = await runPluginCli(["list", "--json", "--workspace", workspaceRoot], { cwd: root })
  expect(JSON.parse(list.stdout).records.map((record: { id: string; kind: string }) => [record.id, record.kind]).sort()).toEqual([
    ["git-plugin", "git"],
    ["npm-plugin", "npm"],
  ])

  await rm(join(workspaceRoot, ".pi", "npm", "npm-plugin"), { recursive: true, force: true })
  const staleRemove = await runPluginCli(["remove", "./npm/npm-plugin", "--workspace", workspaceRoot], { cwd: root })
  expect(staleRemove.stdout).toContain("removed ./npm/npm-plugin")
  expect(await readPiSettingsPackages(join(workspaceRoot, ".pi", "settings.json"))).toEqual(["./git/git-plugin"])

  await runPluginCli(["remove", "git-plugin", "--workspace", workspaceRoot], { cwd: root })
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin"))).rejects.toThrow()
})

test("boring-ui-plugin local install references the source and never installs its dependencies", async () => {
  const root = await tempDir("boring-plugin-source-local-deps-")
  const workspaceRoot = join(root, "workspace")
  const source = join(root, "local-source")
  await mkdir(workspaceRoot, { recursive: true })
  await writeRuntimePlugin(source, "local-dep-plugin", { recharts: "^2.0.0" })

  const install = await runPluginCli(["install", source], { cwd: workspaceRoot })
  expect(install.stdout).toContain("installed local-dep-plugin")
  expect(install.stdout).toContain("Missing dependency: recharts")
  // Local-path sources are an editable tree the author owns: never mutated.
  await expect(access(join(source, "node_modules"))).rejects.toThrow()
})

test("boring-ui-plugin supports explicit global source scope", async () => {
  const root = await tempDir("boring-plugin-source-global-")
  const globalRoot = join(root, "global-agent")
  const workspaceRoot = join(root, "workspace")
  const source = join(root, "global-source")
  await mkdir(workspaceRoot, { recursive: true })
  await writeRuntimePlugin(source, "global-plugin")

  await runPluginCli(["install", "--global", source], {
    cwd: workspaceRoot,
    env: { BORING_UI_PLUGIN_GLOBAL_ROOT: globalRoot },
  })
  const list = await runPluginCli(["list", "--global", "--json"], {
    cwd: workspaceRoot,
    env: { BORING_UI_PLUGIN_GLOBAL_ROOT: globalRoot },
  })
  expect(JSON.parse(list.stdout).records).toEqual([expect.objectContaining({
    id: "global-plugin",
    scope: "global",
    rootDir: resolve(source),
  })])
})

// Eval: scaffolded package.json must use the correct pi.slashCommands shape
// (name + description, no leading slash, no invented keys like command/title/action).
// This catches regressions where the template is updated without the agent-facing
// canonical template, leading agents to invent wrong field names from training data.
test("scaffold produces package.json with correct pi.slashCommands shape", async () => {
  const root = await tempDir("boring-plugin-slash-eval-")
  const workspaceRoot = join(root, "workspace")
  await mkdir(workspaceRoot, { recursive: true })

  await runPluginCli(["scaffold", "my-panel", workspaceRoot], { cwd: workspaceRoot })

  const pkg = JSON.parse(
    await readFile(join(workspaceRoot, ".pi", "extensions", "my-panel", "package.json"), "utf8")
  ) as {
    pi?: {
      extensions?: unknown
      slashCommands?: Array<{ name?: unknown; description?: unknown; command?: unknown; title?: unknown; action?: unknown }>
    }
  }

  // pi.extensions must point to agent/index.ts
  expect(pkg.pi?.extensions).toEqual(["agent/index.ts"])

  // pi.slashCommands must be an array with exactly one entry
  const cmds = pkg.pi?.slashCommands
  expect(Array.isArray(cmds)).toBe(true)
  expect(cmds).toHaveLength(1)

  const cmd = cmds![0]!

  // name must be a non-empty string without a leading slash
  expect(typeof cmd.name).toBe("string")
  expect((cmd.name as string).length).toBeGreaterThan(0)
  expect(cmd.name as string).not.toMatch(/^\//)

  // description must be a non-empty string
  expect(typeof cmd.description).toBe("string")
  expect((cmd.description as string).length).toBeGreaterThan(0)

  // Invented keys must NOT be present
  expect(cmd.command).toBeUndefined()
  expect(cmd.title).toBeUndefined()
  expect(cmd.action).toBeUndefined()
})
