import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { posix, resolve as resolvePath } from "node:path"
import { ErrorCode } from "@hachej/boring-agent/shared"
import { PluginFrontRuntimeError } from "./diagnostics.js"
import { importResolutionCandidates } from "./importCandidates.js"
import { normalizeRequestSubpath } from "./runtimePaths.js"
import type { TrackedPluginRecord } from "./trackedPlugins.js"

/**
 * Immutable per-revision snapshot of a plugin's servable source files.
 *
 * Serving from the snapshot (rather than re-reading disk) is what makes a
 * tracked revision immutable: edits after tracking produce a new revision
 * instead of mutating one the browser already holds. Symlinks are skipped
 * during the walk, so a snapshot key can never resolve outside the plugin.
 *
 * Both the actual front root (`front/` for source-style plugins,
 * `dist/front/` for build-output plugins) and the shared root are walked; the
 * front root prefix is preserved in snapshot keys so the runtime validator
 * resolves the same subpath the request used.
 */
export function snapshotRuntimeSourceFiles(pluginRoot: string, frontRootDir: string, frontRootRelative: string): Map<string, Uint8Array> {
  const snapshot = new Map<string, Uint8Array>()
  const visit = (dir: string, subpathPrefix: string) => {
    if (!existsSync(dir)) return
    try {
      if (lstatSync(dir).isSymbolicLink()) return
    } catch {
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const subpath = `${subpathPrefix}/${entry.name}`
      let normalized: string
      try {
        normalized = normalizeRequestSubpath(subpath)
      } catch {
        continue
      }
      const path = resolvePath(pluginRoot, normalized)
      try {
        if (lstatSync(path).isSymbolicLink()) continue
      } catch {
        continue
      }
      if (entry.isDirectory()) {
        visit(path, normalized)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stats = statSync(path)
        if (!stats.isFile()) continue
        snapshot.set(normalized, readFileSync(path))
      } catch {
        // Best-effort snapshot. Runtime validation still runs before serving.
      }
    }
  }
  visit(frontRootDir, frontRootRelative.split("\\").join("/"))
  visit(resolvePath(pluginRoot, "shared"), "shared")
  return snapshot
}

/** Resolves a relative import between plugin source files against the tracked snapshot. */
export async function resolveImportSubpath(record: TrackedPluginRecord, importerPath: string, source: string): Promise<string> {
  const relativeBase = posix.dirname(importerPath)
  const rawTarget = normalizeRequestSubpath(posix.normalize(posix.join(relativeBase, source)).replaceAll("\\", "/"))

  for (const candidate of importResolutionCandidates(rawTarget, (base, part) => `${base}/${part}`)) {
    if (record.sourceSnapshot.has(candidate)) return candidate
  }

  throw new PluginFrontRuntimeError(ErrorCode.enum.PATH_NOT_FOUND, 404, "resolve", "plugin runtime import not found in tracked revision", {
    importerPath,
    source,
  })
}
