import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import {
  isSafePluginRelativePath,
  validateBoringPluginManifest,
  type BoringPluginManifestIssue,
} from "@hachej/boring-workspace/plugin"

interface PluginSignatureCachePayload {
  version: 1
  serverSignature: string | null
  loadedAt: number
}

function pluginFileSignature(path: string | undefined): string {
  if (!path || !existsSync(path)) return "missing"
  const stat = statSync(path)
  return `${stat.mtimeMs}:${stat.size}`
}

function readPluginSignatureCache(pluginRootDir: string): PluginSignatureCachePayload | null {
  const path = join(pluginRootDir, ".boring-signature.json")
  if (!existsSync(path)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1) return null
  const sig = obj.serverSignature
  if (sig !== null && typeof sig !== "string") return null
  const loadedAt = typeof obj.loadedAt === "number" ? obj.loadedAt : 0
  return { version: 1, serverSignature: sig, loadedAt }
}

interface VerifyPluginOptions {
  /** Workspace root containing `.pi/extensions/`. */
  workspaceRoot: string
  /** Optional plugin name to verify only one; otherwise verifies all. */
  name?: string
}

export interface PluginVerifyOutcome {
  id: string
  dir: string
  ok: boolean
  errors: string[]
  /**
   * Non-fatal informational messages — e.g. "this plugin declares
   * boring.server, which is boot-time/static composition only and is
   * not hot-registered by /reload". Does NOT flip `ok` to false;
   * verify-plugin is about manifest validity, not activation.
   */
  warnings: string[]
}

export interface VerifyPluginResult {
  outcomes: PluginVerifyOutcome[]
  ok: boolean
  /** Absolute path of the `.pi/extensions/` dir that was scanned. */
  extensionsDir: string
  /** True when `.pi/extensions/` doesn't exist at all under the workspace. */
  extensionsDirMissing: boolean
}

/**
 * Verify boring-ui plugins on disk WITHOUT a running workspace server.
 * Runs the same manifest validator the asset manager runs, plus file-
 * existence checks for `boring.front` / `boring.server` / `pi.extensions`
 * paths. Designed to catch the common authoring mistakes (invalid
 * `boring.server` value, missing front file, malformed manifest, etc.)
 * in the same agent turn that wrote the files.
 *
 * Does NOT execute plugin code (no jiti, no Vite). Syntax errors in
 * front/Pi modules only surface when the workspace's real /reload runs;
 * declared `boring.server` files require static composition plus a
 * process restart to execute.
 */
export function verifyPlugin(opts: VerifyPluginOptions): VerifyPluginResult {
  const workspaceRoot = resolve(opts.workspaceRoot)
  const extensionsDir = join(workspaceRoot, ".pi", "extensions")
  if (!existsSync(extensionsDir)) {
    return {
      outcomes: [],
      ok: true,
      extensionsDir,
      extensionsDirMissing: true,
    }
  }

  const targets: string[] = []
  if (opts.name) {
    const dir = join(extensionsDir, opts.name)
    if (!existsSync(dir)) {
      return {
        outcomes: [
          { id: opts.name, dir, ok: false, errors: [`plugin directory not found: ${dir}`], warnings: [] },
        ],
        ok: false,
        extensionsDir,
        extensionsDirMissing: false,
      }
    }
    targets.push(dir)
  } else {
    for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".") || entry.name.startsWith("preflight-")) continue
      targets.push(join(extensionsDir, entry.name))
    }
  }

  const outcomes = targets.map((dir) => verifySinglePlugin(dir))
  return {
    outcomes,
    ok: outcomes.every((o) => o.ok),
    extensionsDir,
    extensionsDirMissing: false,
  }
}

function isInsideRoot(rootReal: string, targetReal: string): boolean {
  const rel = relative(rootReal, targetReal)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

function resolveExistingContainedPath(pluginDir: string, value: string, field: string): { path: string | null; error?: string } {
  if (!isSafePluginRelativePath(value)) {
    return { path: null, error: `${field} must be a safe relative path inside the plugin root: ${JSON.stringify(value)}` }
  }
  const abs = resolve(pluginDir, value)
  if (!existsSync(abs)) return { path: null, error: `${field} points at "${value}" but that file does not exist (looked at ${abs})` }
  const rootReal = realpathSync(pluginDir)
  const targetReal = realpathSync(abs)
  if (!isInsideRoot(rootReal, targetReal)) {
    return { path: null, error: `${field} points at "${value}" but resolves outside the plugin root (looked at ${abs})` }
  }
  return { path: targetReal }
}

function verifySinglePlugin(pluginDir: string): PluginVerifyOutcome {
  const id = pluginDir.split(/[\\/]/).pop() ?? "<unknown>"
  const errors: string[] = []
  const warnings: string[] = []

  const pkgPath = join(pluginDir, "package.json")
  if (!existsSync(pkgPath)) {
    return { id, dir: pluginDir, ok: false, errors: ["package.json missing"], warnings }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { id, dir: pluginDir, ok: false, errors: [`package.json is not valid JSON: ${message}`], warnings }
  }

  const result = validateBoringPluginManifest(parsed)
  if (!result.valid) {
    for (const issue of result.issues) errors.push(formatIssue(issue))
    return { id, dir: pluginDir, ok: false, errors, warnings }
  }

  const manifest = result.packageJson
  const boring = manifest.boring

  // Runtime scanner semantics: boring.front is optional, but when it is
  // declared it must point at an existing file contained by the plugin root.
  // Do not invent a front/index convention here; server/Pi-only packages are valid.
  if (boring?.front) {
    const resolved = resolveExistingContainedPath(pluginDir, boring.front, "boring.front")
    if (resolved.error) errors.push(resolved.error)
  }

  // boring.server, when a string, points at a file that must exist and stay contained.
  // It is intentionally NOT a hot-reload activation path for .pi/extensions user plugins.
  let serverPathAbs: string | null = null
  if (typeof boring?.server === "string") {
    const resolved = resolveExistingContainedPath(pluginDir, boring.server, "boring.server")
    if (resolved.error) {
      errors.push(resolved.error)
    } else {
      serverPathAbs = resolved.path
      warnings.push(
        "boring.server file is valid, but workspace server entries are boot-time/static composition only. /reload does not import or register .pi/extensions server routes/agentTools; restart the workspace with this package passed via defaultPluginPackages or explicit plugins to activate server code.",
      )
    }
  }

  // Restart-needed warning: if the asset manager has loaded this plugin
  // at least once (cache present) and the on-disk server file's
  // signature now differs from what it loaded, the running workspace
  // still holds the OLD server module. A /reload alone will NOT pick up
  // the new server code — the user has to restart the process. Surface
  // that here so the agent doesn't tell the user "run /reload" and then
  // be surprised when their new routes/tools don't appear.
  const cache = readPluginSignatureCache(pluginDir)
  if (cache) {
    const currentServerSig = serverPathAbs ? pluginFileSignature(serverPathAbs) : null
    const cachedSig = cache.serverSignature
    if (cachedSig !== currentServerSig) {
      warnings.push(
        "server file changed since the workspace last loaded this plugin — /reload will hot-swap the front, but routes and agent tools stay on the previously loaded code. Stop and restart the workspace process (Ctrl-C, then re-run your dev command) to pick up the new code.",
      )
    }
  }

  // pi.extensions / pi.skills entries must each exist and stay contained by the plugin root.
  const piExt = (manifest.pi as { extensions?: string[] } | undefined)?.extensions
  if (Array.isArray(piExt)) {
    for (const ext of piExt) {
      if (typeof ext !== "string") continue
      const resolved = resolveExistingContainedPath(pluginDir, ext, "pi.extensions entry")
      if (resolved.error) errors.push(resolved.error)
    }
  }

  const piSkills = (manifest.pi as { skills?: string[] } | undefined)?.skills
  if (Array.isArray(piSkills)) {
    for (const skill of piSkills) {
      if (typeof skill !== "string") continue
      const resolved = resolveExistingContainedPath(pluginDir, skill, "pi.skills entry")
      if (resolved.error) errors.push(resolved.error)
    }
  }

  return { id, dir: pluginDir, ok: errors.length === 0, errors, warnings }
}

function formatIssue(issue: BoringPluginManifestIssue): string {
  return `${issue.code}: ${issue.field}: ${issue.message}`
}

export function formatVerifyResult(result: VerifyPluginResult): string {
  if (result.extensionsDirMissing) {
    return [
      `WARNING — no plugins to verify. Scanned: ${result.extensionsDir} (directory does not exist).`,
      "",
      "If you just wrote a plugin: check that you put it under THIS workspace's `.pi/extensions/` and not a different cwd. The scanned path above is `<cwd>/.pi/extensions/`.",
    ].join("\n")
  }
  if (result.outcomes.length === 0) {
    return [
      `WARNING — scanned ${result.extensionsDir} but found NO plugin directories.`,
      "",
      "If you just wrote a plugin: it is NOT in this dir. Either you wrote to a different `.pi/extensions/` (check your cwd), or the dir name starts with `.` / `preflight-` (skipped).",
    ].join("\n")
  }
  const lines: string[] = []
  const failures = result.outcomes.filter((o) => !o.ok)
  const withWarnings = result.outcomes.filter((o) => o.warnings.length > 0)
  if (failures.length === 0) {
    lines.push(`OK — ${result.outcomes.length} plugin(s) have valid manifests + present files. (scanned ${result.extensionsDir})`)
    for (const outcome of result.outcomes) {
      const tag = outcome.warnings.length > 0 ? "⚠" : "✓"
      lines.push(`  ${tag} ${outcome.id}`)
      for (const w of outcome.warnings) {
        lines.push(`      WARN: ${w}`)
      }
    }
    lines.push("")
    if (withWarnings.length > 0) {
      const n = withWarnings.length
      lines.push(`Manifests are valid, but ${n} plugin${n === 1 ? "" : "s"} need a workspace restart (NOT just /reload) to pick up server-side changes — see WARN lines above.`)
      lines.push("")
    }
    lines.push("Note: this validator does NOT execute plugin code. Front/Pi syntax / type / runtime errors surface on /reload; boring.server files require static composition plus a process restart.")
  } else {
    lines.push(`FAILED — ${failures.length} of ${result.outcomes.length} plugin(s) have errors.  (scanned ${result.extensionsDir})`)
    lines.push("")
    for (const outcome of result.outcomes) {
      if (outcome.ok) {
        const tag = outcome.warnings.length > 0 ? "⚠" : "✓"
        lines.push(`  ${tag} ${outcome.id}`)
        for (const w of outcome.warnings) {
          lines.push(`      WARN: ${w}`)
        }
      } else {
        lines.push(`  ✗ ${outcome.id}  (${outcome.dir})`)
        for (const err of outcome.errors) {
          lines.push(`      ${err}`)
        }
        for (const w of outcome.warnings) {
          lines.push(`      WARN: ${w}`)
        }
      }
    }
    lines.push("")
    lines.push("Fix the errors above and run `boring-ui verify-plugin` again. Once it reports OK, ask the user to run /reload for front/Pi assets; boring.server changes require static composition plus restart.")
  }
  return lines.join("\n")
}

// Turn a raw error string into a one-line hint when we recognize a
// common mistake. Used by the CLI to surface actionable suggestions
// alongside the raw verify output.
const COMMON_MISTAKE_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /boring\.server must be a safe relative path or false/i,
    hint:
      'Set `boring.server` to a string path like "server/index.ts", or to `false` (or omit the field). It is NOT a boolean true. For hot-reloadable agent behavior in .pi/extensions, prefer pi.extensions instead.',
  },
  {
    pattern: /package\.json manifest must be an object/i,
    hint: "package.json must parse as a JSON object — check for trailing commas or unquoted keys.",
  },
]

export function findHintForError(message: string): string | undefined {
  for (const m of COMMON_MISTAKE_HINTS) {
    if (m.pattern.test(message)) return m.hint
  }
  return undefined
}
