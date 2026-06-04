import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface CreatePluginOptions {
  name: string
  path?: string
  cwd?: string
}

export interface CreatePluginResult {
  id: string
  pluginDir: string
  packageName: string
  filesCreated: string[]
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function findRepoRoot(from: string): string | null {
  let current = from
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function walkDir(dir: string, base: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walkDir(fullPath, base, out)
      continue
    }
    out.push(relative(base, fullPath))
  }
  return out
}

function replaceInFile(filePath: string, replacements: Record<string, string>): void {
  let content = readFileSync(filePath, "utf8")
  for (const [from, to] of Object.entries(replacements)) {
    content = content.replaceAll(from, to)
  }
  writeFileSync(filePath, content, "utf8")
}

function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  while (true) {
    const pkgPath = join(current, "package.json")
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string }
        if (pkg.name === "@hachej/boring-ui-plugin-cli") return current
      } catch { /* keep walking */ }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error("Could not locate @hachej/boring-ui-plugin-cli package root")
}

export function createPlugin(options: CreatePluginOptions): CreatePluginResult {
  const cwd = options.cwd ?? process.cwd()
  const name = options.name
  const templateDir = join(packageRoot(), "templates", "plugin")
  if (!existsSync(templateDir)) {
    throw new Error(
      `Plugin template not found at ${templateDir}.\n` +
      "This build may not include the plugin template.",
    )
  }

  if (!KEBAB_RE.test(name)) {
    throw new Error(
      `invalid plugin name "${name}" — must be kebab-case (e.g. "my-plugin")`,
    )
  }

  const repoRoot = findRepoRoot(cwd)
  const targetParent = options.path ? resolve(cwd, options.path) : join(repoRoot ?? cwd, "plugins")
  const targetDir = join(targetParent, name)
  if (existsSync(targetDir)) throw new Error(`Directory already exists: ${targetDir}`)

  const id = name
  const symbolBase = id.replace(/-plugin$/, "") || id
  const pascalBase = symbolBase
    .split(/[-_]+/)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("")
  const camelBase = pascalBase.charAt(0).toLowerCase() + pascalBase.slice(1)
  const upperBase = symbolBase.replace(/-/g, "_").toUpperCase()
  const packageName = `@hachej/boring-${id}`

  mkdirSync(targetParent, { recursive: true })
  cpSync(templateDir, targetDir, { recursive: true })

  const files = walkDir(targetDir, targetDir)
  for (const file of files) {
    const fullPath = join(targetDir, file)
    replaceInFile(fullPath, {
      "@hachej/boring-plugin-template": packageName,
      "sample-plugin": id,
      "sample-panel": `${id}-panel`,
      "sample.open": `${id}.open`,
      "sample:": `${id}:`,
      '"sample"': `"${id}"`,
      SAMPLE: upperBase,
      Sample: pascalBase,
      sampleSurfaceResolver: `${camelBase}SurfaceResolver`,
      samplePanel: `${camelBase}Panel`,
    })

    if (file.includes("samplePlugin")) {
      const newFile = file.replace(/samplePlugin/g, `${camelBase}Plugin`)
      const oldPath = join(targetDir, file)
      const newPath = join(targetDir, newFile)
      if (oldPath !== newPath) {
        mkdirSync(dirname(newPath), { recursive: true })
        renameSync(oldPath, newPath)
      }
    }
  }

  return {
    id,
    pluginDir: targetDir,
    packageName,
    filesCreated: walkDir(targetDir, targetDir),
  }
}
