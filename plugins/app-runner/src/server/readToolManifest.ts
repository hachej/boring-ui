import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { APP_RUNNER_TOOLS_MANIFEST_FILENAME } from "../shared/constants"
import type { AppRunnerToolManifest } from "../shared/types"

/**
 * Reads and minimally validates `<dir>/tools.json` (e.g. `app/tools.json`)
 * from the workspace, per APP-RUNNER-SPEC.md's manifest format. Returns
 * `undefined` when the file doesn't exist or isn't a well-formed manifest —
 * the manifest is optional, so a missing/invalid file must not fail publish.
 */
export async function readToolManifest(workspaceRoot: string, dir: string): Promise<AppRunnerToolManifest | undefined> {
  const path = join(workspaceRoot, dir, APP_RUNNER_TOOLS_MANIFEST_FILENAME)
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return isValidManifest(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Extracts a tool manifest from a `GET /w/{ws}/{app}/versions/{n}/files`
 * response: prefer an explicit `manifest` field, else parse `app/tools.json`
 * out of the returned `files` map (the exact response shape isn't finalized
 * upstream, so this accepts either).
 */
export function manifestFromVersionFiles(response: { files?: Record<string, string>; manifest?: unknown }): AppRunnerToolManifest | undefined {
  if (isValidManifest(response.manifest)) return response.manifest
  const raw = response.files?.[`app/${APP_RUNNER_TOOLS_MANIFEST_FILENAME}`]
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return isValidManifest(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isValidManifest(value: unknown): value is AppRunnerToolManifest {
  if (!value || typeof value !== "object") return false
  const candidate = value as { tools?: unknown; bindings?: unknown }
  if (!Array.isArray(candidate.tools)) return false
  if (candidate.bindings !== undefined && !Array.isArray(candidate.bindings)) return false
  return candidate.tools.every((entry) => {
    if (!entry || typeof entry !== "object") return false
    const tool = entry as { name?: unknown; route?: unknown }
    return typeof tool.name === "string" && tool.name.length > 0 && typeof tool.route === "string" && tool.route.length > 0
  })
}
