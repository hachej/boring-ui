import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface ScaffoldPluginOptions {
  /** Plugin id — must be kebab-case, used as folder name + npm package name. */
  name: string
  /** Workspace root the .pi/extensions/<name>/ folder is created under. */
  workspaceRoot: string
  /** Optional override for the canonical templates dir (test escape hatch). */
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
  // Create the plugin dir up-front with recursive:false on the leaf so
  // we get EEXIST atomically — protects against two parallel scaffold
  // runs racing on existsSync. Parent dirs (.pi/extensions/) come
  // through mkdirSync({recursive:true}) below.
  mkdirSync(join(workspaceRoot, ".pi", "extensions"), { recursive: true })
  try {
    mkdirSync(pluginDir, { recursive: false })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "EEXIST") {
      throw new Error(`plugin already exists at ${pluginDir}`)
    }
    throw error
  }

  const templatesDir = opts.templatesDir ?? resolveBundledTemplatesDir()
  if (!templatesDir) {
    throw new Error(
      "could not locate bundled plugin templates — pass `templatesDir` explicitly. " +
        "(this usually indicates a broken @hachej/boring-ui-plugin-cli install)",
    )
  }
  const tplFront = join(templatesDir, "front-canonical.tsx")
  const tplPackage = join(templatesDir, "package-canonical.json")
  for (const tpl of [tplFront, tplPackage]) {
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
  // and substitute placeholders. The default scaffold is hot-reloadable
  // front + Pi metadata only; `boring.server` is an advanced boot-time /
  // static composition path and is not activated by `/reload` for
  // `.pi/extensions` user plugins.
  const pkgRaw = JSON.parse(readFileSync(tplPackage, "utf8")) as {
    _doc_?: unknown
    [key: string]: unknown
  }
  delete pkgRaw._doc_
  const pkgJson = substitute(JSON.stringify(pkgRaw, null, 2), opts.name, label)
  write("package.json", `${pkgJson}\n`)

  const frontSource = substitute(readFileSync(tplFront, "utf8"), opts.name, label)
  write("front/index.tsx", frontSource)

  // .gitignore: keep machine-managed sidecars out of the plugin author's
  // git history. `.boring-signature.json` is written by the asset manager
  // on every load (used by verify-plugin to detect server-file drift) and
  // would otherwise show up as a dirty working tree after every dev
  // session.
  write(".gitignore", "# Machine-managed sidecars written by the boring-ui plugin runtime.\n.boring-signature.json\n")

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
 * Resolve the templates dir bundled with this package. Source files live at
 * `src/server/*` while tsup bundles implementation chunks under `dist/`, so
 * support both relative depths.
 */
function resolveBundledTemplatesDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(here, "..", "templates"),
    resolve(here, "..", "..", "templates"),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}
