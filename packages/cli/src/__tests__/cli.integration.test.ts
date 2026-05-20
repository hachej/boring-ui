import { execFile as execFileCallback, execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { afterEach, beforeAll, expect, test } from "vitest"

const execFile = promisify(execFileCallback)
const testDir = dirname(fileURLToPath(import.meta.url))
const cliRoot = resolve(testDir, "../..")
const distBin = join(cliRoot, "dist", "index.js")
const tempDirs: string[] = []

beforeAll(() => {
  execFileSync("pnpm", ["--dir", cliRoot, "build"], { stdio: "pipe" })
}, 60_000)

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function testEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  // Preserve the caller's environment exactly. Boring CLI subcommands should
  // simply ignore model-provider env vars; tests must not mutate/scrub them.
  return { ...process.env, ...overrides, NO_COLOR: "1" }
}

async function runCli(args: string[], env: Record<string, string>) {
  return await execFile(process.execPath, [distBin, ...args], {
    cwd: cliRoot,
    env: testEnv(env),
    timeout: 10_000,
  })
}

test("package exposes an installable boring-ui bin with published assets", async () => {
  const packageJson = JSON.parse(await readFile(join(cliRoot, "package.json"), "utf-8")) as {
    bin?: Record<string, string>
    files?: string[]
    dependencies?: Record<string, string>
  }

  expect(packageJson.bin?.["boring-ui"]).toBe("./dist/index.js")
  expect(packageJson.files).toEqual(expect.arrayContaining(["dist/", "public/"]))
  expect(packageJson.dependencies).toEqual(expect.objectContaining({
    "@fastify/static": expect.any(String),
    "@hachej/boring-agent": expect.any(String),
    "@hachej/boring-workspace": expect.any(String),
    fastify: expect.any(String),
  }))

  const builtBin = await readFile(distBin, "utf-8")
  expect(builtBin.startsWith("#!/usr/bin/env node")).toBe(true)
})

test("installed CLI workspace subcommands use an isolated registry", async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const project = await makeTempDir("boring-cli-install-project-")
  const registryPath = join(root, "workspaces.yaml")
  const env = { BORING_UI_WORKSPACES_PATH: registryPath }

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })

  const addResult = await runCli(["workspaces", "add", project], env)
  expect(addResult.stdout).toContain(project)
  const id = addResult.stdout.match(/id\s+(\S+)/)?.[1]
  if (!id) throw new Error(`missing workspace id in output: ${addResult.stdout}`)

  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(id),
  })

  await expect(runCli(["workspaces", "rename", id, "Renamed", "Project"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("Renamed Project"),
  })

  await expect(runCli(["workspaces", "remove", id], env)).resolves.toMatchObject({
    stdout: expect.stringContaining(`removed ${id}`),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
}, 20_000)

test("installed CLI rejects file paths as local workspaces", async () => {
  const root = await makeTempDir("boring-cli-install-root-")
  const fileDir = await makeTempDir("boring-cli-install-file-")
  const file = join(fileDir, "not-a-workspace.txt")
  await writeFile(file, "not a directory", "utf-8")
  const env = { BORING_UI_WORKSPACES_PATH: join(root, "workspaces.yaml") }

  await expect(runCli(["workspaces", "add", file], env)).rejects.toMatchObject({
    stderr: expect.stringContaining("workspace path is not a directory"),
  })
  await expect(runCli(["workspaces", "list"], env)).resolves.toMatchObject({
    stdout: expect.stringContaining("No workspaces"),
  })
}, 20_000)
