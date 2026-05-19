import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface ScaffoldPluginOptions {
  /** Plugin id — must be kebab-case, used as folder name + npm package name. */
  name: string
  /** Workspace root the .pi/extensions/<name>/ folder is created under. */
  workspaceRoot: string
  /**
   * Optional override for the canonical templates directory. Useful for
   * tests + when boring-pi isn't reachable from process.cwd() (resolution
   * walks up to find @hachej/boring-pi/references/workspace/templates/).
   */
  templatesDir?: string
}

export interface ScaffoldPluginResult {
  pluginDir: string
  filesCreated: string[]
}

const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

export function scaffoldPlugin(opts: ScaffoldPluginOptions): ScaffoldPluginResult {
  if (!KEBAB_RE.test(opts.name)) {
    throw new Error(
      `invalid plugin name "${opts.name}" — must be kebab-case (e.g. "my-plugin")`,
    )
  }
  const workspaceRoot = resolve(opts.workspaceRoot)
  const pluginDir = join(workspaceRoot, ".pi", "extensions", opts.name)
  if (existsSync(pluginDir)) {
    throw new Error(`plugin already exists at ${pluginDir}`)
  }

  const templatesDir = opts.templatesDir ?? resolveCanonicalTemplatesDir(workspaceRoot)
  if (!templatesDir) {
    throw new Error(
      "could not locate @hachej/boring-pi/references/workspace/templates/ — " +
        "pass `templatesDir` explicitly or install @hachej/boring-pi.",
    )
  }
  const tplFront = join(templatesDir, "front-canonical.tsx")
  const tplServer = join(templatesDir, "server-canonical.ts")
  const tplPackage = join(templatesDir, "package-canonical.json")
  for (const tpl of [tplFront, tplServer, tplPackage]) {
    if (!existsSync(tpl)) {
      throw new Error(`canonical template missing: ${tpl}`)
    }
  }

  const label = labelFromName(opts.name)
  const filesCreated: string[] = []
  const write = (relPath: string, contents: string) => {
    const target = join(pluginDir, relPath)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, contents, "utf8")
    filesCreated.push(target)
  }

  // package-canonical.json carries a `_doc_` instructional key — strip it
  // and substitute placeholders.
  const pkgRaw = JSON.parse(readFileSync(tplPackage, "utf8")) as Record<string, unknown>
  delete pkgRaw._doc_
  const pkgJson = substitute(JSON.stringify(pkgRaw, null, 2), opts.name, label)
  write("package.json", `${pkgJson}\n`)

  const frontSource = substitute(readFileSync(tplFront, "utf8"), opts.name, label)
  write("front/index.tsx", frontSource)

  return { pluginDir, filesCreated }
}

function labelFromName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function substitute(source: string, name: string, label: string): string {
  // Templates use literal "<kebab-name>" and "<Label>" placeholders.
  // We also rename the placeholder `MyPane` component to a plugin-
  // specific PascalCase name so scaffolded files are immediately
  // distinct when multiple plugins coexist.
  const paneName = `${pascalCase(name)}Pane`
  return source
    .replaceAll("<kebab-name>", name)
    .replaceAll("&lt;kebab-name&gt;", name)
    .replaceAll("<Label>", label)
    .replaceAll(/\bMyPane\b/g, paneName)
}

function pascalCase(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/**
 * Walk up from the workspace root (then this module's location) looking
 * for `node_modules/@hachej/boring-pi/references/workspace/templates`.
 * Returns undefined if not found.
 */
function resolveCanonicalTemplatesDir(workspaceRoot: string): string | undefined {
  const relPath = ["node_modules", "@hachej", "boring-pi", "references", "workspace", "templates"]

  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [workspaceRoot, here]
  for (const start of candidates) {
    let dir = resolve(start)
    while (true) {
      const candidate = join(dir, ...relPath)
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  // Last-resort: this CLI's repo layout has boring-pi as a sibling package
  // under packages/pi/references/workspace/templates (no node_modules step).
  const repoCandidate = join(here, "..", "..", "..", "..", "pi", "references", "workspace", "templates")
  if (existsSync(repoCandidate)) return repoCandidate
  return undefined
}
