import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  validateBoringPluginManifest,
  type BoringPluginManifestIssue,
} from "@hachej/boring-workspace/plugin"
import {
  pluginFileSignature,
  readPluginSignatureCache,
} from "@hachej/boring-workspace/server"

export interface VerifyPluginOptions {
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
   * Non-fatal informational messages — e.g. "server file changed since
   * the workspace last loaded this plugin; a /reload will hot-swap the
   * front but routes/agentTools stay on the previously loaded code
   * until you restart". Does NOT flip `ok` to false; verify-plugin is
   * about manifest validity, not freshness.
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
 * front/server modules only surface when the workspace's real /reload
 * runs.
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

  // boring.front file must exist if declared (else convention path is checked).
  if (boring?.front) {
    const frontPath = join(pluginDir, boring.front)
    if (!existsSync(frontPath)) {
      errors.push(`boring.front points at "${boring.front}" but that file does not exist (looked at ${frontPath})`)
    }
  } else {
    // Convention: front/index.tsx or front/index.ts
    const candidates = ["front/index.tsx", "front/index.ts"]
    const found = candidates.find((c) => existsSync(join(pluginDir, c)))
    if (!found) {
      errors.push(
        `no front entry found and boring.front not declared (looked at: ${candidates.join(", ")})`,
      )
    }
  }

  // boring.server, when a string, points at a file that must exist.
  let serverPathAbs: string | null = null
  if (typeof boring?.server === "string") {
    serverPathAbs = join(pluginDir, boring.server)
    if (!existsSync(serverPathAbs)) {
      errors.push(`boring.server points at "${boring.server}" but that file does not exist (looked at ${serverPathAbs})`)
      serverPathAbs = null
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
        `server file changed since the workspace last loaded this plugin — a /reload will hot-swap the front, but routes and agentTools stay on the previously loaded code until you restart the workspace process (cached signature: ${cachedSig ?? "none"}, current: ${currentServerSig ?? "none"})`,
      )
    }
  }

  // pi.extensions entries must each exist.
  const piExt = (manifest.pi as { extensions?: string[] } | undefined)?.extensions
  if (Array.isArray(piExt)) {
    for (const ext of piExt) {
      if (typeof ext !== "string") continue
      const extPath = join(pluginDir, ext)
      if (!existsSync(extPath)) {
        errors.push(`pi.extensions entry "${ext}" does not exist (looked at ${extPath})`)
      }
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
      lines.push("Manifests are valid, but one or more plugins need a workspace restart (NOT just /reload) to pick up server-side changes — see WARN lines above.")
      lines.push("")
    }
    lines.push("Note: this validator does NOT execute plugin code. Syntax / type / runtime errors only surface on /reload.")
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
    lines.push("Fix the errors above and run `boring-ui verify-plugin` again. Once it reports OK, ask the user to run /reload.")
  }
  return lines.join("\n")
}

export interface RecognizedMistake {
  pattern: RegExp
  hint: string
}

/**
 * Optional helper — turn a raw error string into a one-line hint when
 * we recognize a common mistake. Used by the CLI command to surface
 * actionable suggestions. NOT part of verifyPlugin itself (which stays
 * pure / structured) so callers can render however they like.
 */
export const COMMON_MISTAKE_HINTS: RecognizedMistake[] = [
  {
    pattern: /boring\.server must be a safe relative path or false/i,
    hint:
      'Set `boring.server` to a string path like "server/index.ts", or to `false` (or omit the field). It is NOT a boolean true.',
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
