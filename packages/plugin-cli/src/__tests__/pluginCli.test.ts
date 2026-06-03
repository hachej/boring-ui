import { execFile } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { afterEach, expect, test } from "vitest"

const execFileAsync = promisify(execFile)
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

  const scaffold = await execFileAsync(bin, ["scaffold", "tiny-runtime", workspaceRoot], { cwd: installRoot })
  expect(scaffold.stdout).toContain("scaffolded tiny-runtime")

  const verify = await execFileAsync(bin, ["verify", "tiny-runtime", workspaceRoot], { cwd: installRoot })
  expect(verify.stdout).toContain("OK — 1 plugin")
})
