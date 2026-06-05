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

test("boring-ui-plugin install/list/remove defaults to workspace-local records without the main CLI", async () => {
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

  const records = JSON.parse(await readFile(join(workspaceRoot, ".pi", "boring-plugin-sources.json"), "utf8")) as {
    sources: Array<{ id: string; kind: string; scope: string; rootDir: string; source: string }>
  }
  expect(records.sources).toEqual([expect.objectContaining({
    id: "local-plugin",
    kind: "local",
    scope: "local",
    rootDir: resolve(source),
    source: resolve(source),
  })])

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

test("boring-ui-plugin installs git and npm plugin source without installing dependencies", async () => {
  const root = await tempDir("boring-plugin-source-remote-")
  const workspaceRoot = join(root, "workspace")
  const gitSource = join(root, "git-source")
  const npmSource = join(root, "npm-source")
  await mkdir(workspaceRoot, { recursive: true })
  await writeRuntimePlugin(gitSource, "git-plugin", { leftpad: "^0.0.1" })
  await writeRuntimePlugin(npmSource, "npm-plugin", { leftpad: "^0.0.1" })

  await execFileAsync("git", ["init"], { cwd: gitSource })
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: gitSource })
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: gitSource })
  await execFileAsync("git", ["add", "."], { cwd: gitSource })
  await execFileAsync("git", ["commit", "-m", "init"], { cwd: gitSource })

  const gitInstall = await runPluginCli(["install", `git:${gitSource}`, "--workspace", workspaceRoot], { cwd: root })
  expect(gitInstall.stderr).toContain("Security: Boring plugins run as trusted local code")
  expect(gitInstall.stdout).toContain("installed git-plugin")
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin", "package.json"))).resolves.toBeUndefined()
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin", "node_modules"))).rejects.toThrow()

  const npmInstall = await runPluginCli(["install", `npm:${npmSource}`, "--workspace", workspaceRoot], { cwd: root })
  expect(npmInstall.stderr).toContain("Security: Boring plugins run as trusted local code")
  expect(npmInstall.stdout).toContain("installed npm-plugin")
  await expect(access(join(workspaceRoot, ".pi", "npm", "npm-plugin", "package.json"))).resolves.toBeUndefined()
  await expect(access(join(workspaceRoot, ".pi", "npm", "npm-plugin", "node_modules"))).rejects.toThrow()

  const list = await runPluginCli(["list", "--json", "--workspace", workspaceRoot], { cwd: root })
  expect(JSON.parse(list.stdout).records.map((record: { id: string; kind: string }) => [record.id, record.kind]).sort()).toEqual([
    ["git-plugin", "git"],
    ["npm-plugin", "npm"],
  ])

  await runPluginCli(["remove", "git-plugin", "--workspace", workspaceRoot], { cwd: root })
  await expect(access(join(workspaceRoot, ".pi", "git", "git-plugin"))).rejects.toThrow()
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
