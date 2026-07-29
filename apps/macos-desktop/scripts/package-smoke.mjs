import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const appRoot = resolve(import.meta.dirname, "..")
const arch = process.arch === "arm64" ? "arm64" : "x64"
const stageRoot = resolve(process.env.BORING_DESKTOP_STAGE_ROOT ?? tmpdir())

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`)
}

run("pnpm", ["run", "build:full"])
const forgeResultPath = join(stageRoot, `boring-desktop-forge-result-${process.pid}.json`)
run("node", ["scripts/forge-staged.mjs", "package", "--platform=linux", `--arch=${arch}`], {
  env: {
    ...process.env,
    BORING_DESKTOP_FORGE_RESULT_PATH: forgeResultPath,
    BORING_DESKTOP_SMOKE_BUILD: "1",
    BORING_DESKTOP_STAGE_ROOT: stageRoot,
  },
})
const { outDir } = JSON.parse(await readFile(forgeResultPath, "utf8"))

const root = await mkdtemp(join(stageRoot, "boring-desktop-package-smoke-"))
const home = join(root, "home")
const workspace = join(root, "workspace")
const pluginRoot = join(home, ".pi", "agent", "extensions", "desktop-smoke-plugin")
const reportPath = join(root, "report.json")
const registryPath = join(root, "workspaces.json")
await mkdir(join(pluginRoot, "front"), { recursive: true })
await mkdir(workspace, { recursive: true })
await writeFile(join(pluginRoot, "front", "index.tsx"), `import { definePlugin } from "@hachej/boring-workspace/plugin"\nexport default definePlugin({ id: "desktop-smoke-plugin" })\n`, "utf8")
await writeFile(join(pluginRoot, "package.json"), JSON.stringify({
  name: "desktop-smoke-plugin",
  boring: { front: "front/index.tsx" },
}), "utf8")
const now = new Date().toISOString()
await writeFile(registryPath, JSON.stringify({
  version: 1,
  workspaces: [{
    id: "desktop-smoke-workspace",
    name: "Desktop smoke workspace",
    path: workspace,
    createdAt: now,
    updatedAt: now,
  }],
}), "utf8")

const outEntries = await readdir(outDir, { withFileTypes: true })
const packageDirectory = outEntries
  .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-linux-${arch}`))
  .map((entry) => join(outDir, entry.name))[0]
if (!packageDirectory) throw new Error(`Forge did not create a linux-${arch} package`)
const executable = join(packageDirectory, "boring-ui")
// Forge's Linux package has an unprivileged chrome-sandbox in CI containers.
// The smoke validates package/runtime closure; unit tests enforce BrowserWindow sandbox settings.
const launch = spawnSync("xvfb-run", ["--auto-servernum", executable, "--no-sandbox"], {
  cwd: root,
  encoding: "utf8",
  timeout: 180_000,
  env: {
    ...process.env,
    HOME: home,
    BORING_UI_WORKSPACES_PATH: registryPath,
    BORING_AGENT_SESSION_ROOT: join(root, "pi-sessions"),
    BORING_DESKTOP_SMOKE_REPORT_PATH: reportPath,
  },
})
if (launch.error) throw launch.error
if (launch.status !== 0) {
  process.stderr.write(launch.stdout ?? "")
  process.stderr.write(launch.stderr ?? "")
  throw new Error(`packaged desktop exited ${launch.status}`)
}

const report = JSON.parse(await readFile(reportPath, "utf8"))
const expectedStatuses = [report.rootStatus, report.workspacesStatus, report.diagnosticsStatus, report.pluginsStatus]
if (!report.ok || expectedStatuses.some((status) => status !== 200)) {
  throw new Error(`packaged desktop HTTP proof failed: ${JSON.stringify(report)}`)
}
for (const pluginId of ["ask-user", "diagram", "tasks", "desktop-smoke-plugin"]) {
  if (!report.plugins.includes(pluginId)) {
    throw new Error(`packaged desktop did not discover ${pluginId}: ${JSON.stringify(report.plugins)}`)
  }
}
try {
  await fetch(report.origin, { signal: AbortSignal.timeout(2_000) })
  throw new Error(`packaged desktop listener remained reachable after quit: ${report.origin}`)
} catch (error) {
  if (error instanceof Error && error.message.includes("remained reachable")) throw error
}

console.log(JSON.stringify({
  packageDirectory,
  report,
  listenerReleased: true,
}, null, 2))
