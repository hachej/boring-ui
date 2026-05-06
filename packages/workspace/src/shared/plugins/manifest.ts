/**
 * Boring plugin manifest validation.
 *
 * Browser-safe: no node:* imports, no fs, no path.
 */

export type BoringPluginRuntime = "front" | "server" | "both"

export interface BoringPluginPermissions {
  /** Can register panels */
  panels?: boolean
  /** Can register commands */
  commands?: boolean
  /** Can register surface resolvers */
  surfaceResolvers?: boolean
  /** Can register context providers */
  providers?: boolean
}

export interface BoringPluginManifest {
  /** Plugin identifier e.g. "csv-viewer". Must be kebab-case alphanumeric, 2-64 chars. */
  id: string
  /** Semver version string */
  version: string
  /** Human-readable display name */
  label?: string
  description?: string
  /** Execution target. Defaults to "front". */
  runtime?: BoringPluginRuntime
  permissions?: BoringPluginPermissions
  /** Relative path to plugin entry file. Defaults to "plugin.ts". */
  entry?: string
}

export type BoringPluginManifestErrorCode =
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_ENTRY_PATH"
  | "INVALID_GLOB"
  | "MISSING_REQUIRED_FIELD"
  | "UNKNOWN_FIELD"

export interface BoringPluginManifestIssue {
  code: BoringPluginManifestErrorCode
  field: string
  message: string
}

export type BoringPluginManifestValidationResult =
  | { valid: true; manifest: BoringPluginManifest }
  | { valid: false; issues: BoringPluginManifestIssue[] }

export interface ValidateBoringPluginManifestOptions {
  /** In strict mode, unknown fields are rejected. Default: false. */
  strict?: boolean
  /**
   * Plugin ids that are reserved by workspace internals.
   * A manifest whose `id` matches any of these will fail with INVALID_ID.
   */
  reservedIds?: string[]
}

export const BORING_PLUGIN_MANIFEST_ERROR_CODES: Record<
  BoringPluginManifestErrorCode,
  BoringPluginManifestErrorCode
> = {
  INVALID_ID: "INVALID_ID",
  INVALID_VERSION: "INVALID_VERSION",
  INVALID_ENTRY_PATH: "INVALID_ENTRY_PATH",
  INVALID_GLOB: "INVALID_GLOB",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
}

const KNOWN_FIELDS = new Set<string>([
  "id",
  "version",
  "label",
  "description",
  "runtime",
  "permissions",
  "entry",
])

const KNOWN_PERMISSION_FIELDS = new Set<string>([
  "panels",
  "commands",
  "surfaceResolvers",
  "providers",
])

const VALID_RUNTIMES: BoringPluginRuntime[] = ["front", "server", "both"]

/** Matches semver: 1.2.3, 0.0.1, 1.0.0-beta.1, etc. */
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Plugin ids must be kebab-case alphanumeric, 2–64 chars. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]{2}$/

/**
 * Returns true when the id is a valid boring plugin id:
 * - lowercase alphanumeric and hyphens only
 * - 2–64 characters
 * - no leading/trailing/consecutive hyphens
 */
export function isValidBoringPluginId(id: string): boolean {
  if (typeof id !== "string") return false
  if (!PLUGIN_ID_RE.test(id)) return false
  // No consecutive hyphens, no leading/trailing hyphen
  if (id.includes("--")) return false
  if (id.startsWith("-") || id.endsWith("-")) return false
  return true
}

/**
 * Returns true when `p` is a safe plugin-relative path:
 * - non-empty and not "." or ".."
 * - not absolute (no leading "/", no Windows drive "C:\", no UNC "\\")
 * - no `../` or `..\` traversal
 * - no backslashes (Windows path separator)
 * - no null bytes
 * - no URL-encoded traversal (`%2e%2e`, case-insensitive)
 */
export function isSafePluginRelativePath(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false
  // Reject bare "." or ".."
  if (p === "." || p === "..") return false
  // Reject absolute paths
  if (p.startsWith("/")) return false
  // Reject Windows drive paths: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(p)) return false
  // Reject UNC paths: \\ or //
  if (p.startsWith("\\\\") || p.startsWith("//")) return false
  // Reject backslashes (Windows path separator that could hide traversal)
  if (p.includes("\\")) return false
  // Reject null bytes
  if (p.includes("\0")) return false
  // Reject URL-encoded traversal (e.g. %2e%2e, %2E%2E, mixed case)
  if (/(?:%2e){2}/i.test(p)) return false
  // Reject traversal segments
  if (p.includes("../") || p === "..") return false
  // Reject path that starts with ../
  if (p.startsWith("../")) return false
  return true
}

/**
 * Returns true when `p` is a safe relative glob:
 * - passes isSafePluginRelativePath
 * - no negation patterns (leading `!`)
 * - no `..` segment anywhere
 * - no brace expansion containing `..` (e.g. `{../foo,bar}`)
 * - no `**` combined with `..` in any form
 */
export function isSafePluginRelativeGlob(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return false
  // No negation patterns
  if (p.startsWith("!")) return false
  // Base path safety (handles absolute, traversal, null bytes, etc.)
  if (!isSafePluginRelativePath(p)) return false
  // Split on / and reject any .. segment
  const segments = p.split("/")
  for (const seg of segments) {
    if (seg === "..") return false
  }
  // Reject brace expansion containing `..`
  // e.g. {../evil,ok} or {foo,../../bar}
  if (/\{[^}]*\.\.[^}]*\}/.test(p)) return false
  // Reject `**` adjacent to `..` in any combination
  if (/\*\*.*\.\./.test(p) || /\.\..*\*\*/.test(p)) return false
  return true
}

function issue(
  code: BoringPluginManifestErrorCode,
  field: string,
  message: string,
): BoringPluginManifestIssue {
  return { code, field, message }
}

/**
 * Validates a raw `boring.plugin.json` manifest object.
 *
 * Browser-safe — no Node.js APIs used.
 */
export function validateBoringPluginManifest(
  raw: unknown,
  opts?: ValidateBoringPluginManifestOptions,
): BoringPluginManifestValidationResult {
  const issues: BoringPluginManifestIssue[] = []
  const strict = opts?.strict ?? false
  const reservedIds = new Set<string>(opts?.reservedIds ?? [])

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push(
      issue("MISSING_REQUIRED_FIELD", "<root>", "Manifest must be a non-null object"),
    )
    return { valid: false, issues }
  }

  const obj = raw as Record<string, unknown>

  // Check unknown fields in strict mode
  if (strict) {
    for (const key of Object.keys(obj)) {
      if (!KNOWN_FIELDS.has(key)) {
        issues.push(
          issue(
            "UNKNOWN_FIELD",
            key,
            `Unknown field "${key}" in manifest`,
          ),
        )
      }
    }
  }

  // id — required
  if (!("id" in obj) || obj.id === undefined || obj.id === null || obj.id === "") {
    issues.push(issue("MISSING_REQUIRED_FIELD", "id", 'Required field "id" is missing'))
  } else if (typeof obj.id !== "string") {
    issues.push(issue("INVALID_ID", "id", '"id" must be a string'))
  } else if (!isValidBoringPluginId(obj.id)) {
    issues.push(
      issue(
        "INVALID_ID",
        "id",
        `"id" must be kebab-case alphanumeric, 2–64 chars (got: "${obj.id}")`,
      ),
    )
  } else if (reservedIds.has(obj.id as string)) {
    issues.push(
      issue(
        "INVALID_ID",
        "id",
        `"id" "${obj.id}" is reserved by the workspace and cannot be used by plugins`,
      ),
    )
  }

  // version — required
  if (!("version" in obj) || obj.version === undefined || obj.version === null || obj.version === "") {
    issues.push(
      issue("MISSING_REQUIRED_FIELD", "version", 'Required field "version" is missing'),
    )
  } else if (typeof obj.version !== "string") {
    issues.push(issue("INVALID_VERSION", "version", '"version" must be a string'))
  } else if (!SEMVER_RE.test(obj.version)) {
    issues.push(
      issue(
        "INVALID_VERSION",
        "version",
        `"version" must be a valid semver string (got: "${obj.version}")`,
      ),
    )
  }

  // label — optional string
  if ("label" in obj && obj.label !== undefined && typeof obj.label !== "string") {
    issues.push(issue("MISSING_REQUIRED_FIELD", "label", '"label" must be a string when provided'))
  }

  // description — optional string
  if (
    "description" in obj &&
    obj.description !== undefined &&
    typeof obj.description !== "string"
  ) {
    issues.push(
      issue(
        "MISSING_REQUIRED_FIELD",
        "description",
        '"description" must be a string when provided',
      ),
    )
  }

  // runtime — optional enum
  if ("runtime" in obj && obj.runtime !== undefined) {
    if (!VALID_RUNTIMES.includes(obj.runtime as BoringPluginRuntime)) {
      issues.push(
        issue(
          "MISSING_REQUIRED_FIELD",
          "runtime",
          `"runtime" must be one of ${VALID_RUNTIMES.join(", ")} (got: "${obj.runtime}")`,
        ),
      )
    }
  }

  // permissions — optional object
  if ("permissions" in obj && obj.permissions !== undefined) {
    if (typeof obj.permissions !== "object" || Array.isArray(obj.permissions) || obj.permissions === null) {
      issues.push(
        issue(
          "MISSING_REQUIRED_FIELD",
          "permissions",
          '"permissions" must be an object when provided',
        ),
      )
    } else {
      const perms = obj.permissions as Record<string, unknown>
      if (strict) {
        for (const key of Object.keys(perms)) {
          if (!KNOWN_PERMISSION_FIELDS.has(key)) {
            issues.push(
              issue("UNKNOWN_FIELD", `permissions.${key}`, `Unknown permission field "${key}"`),
            )
          }
        }
      }
      for (const key of KNOWN_PERMISSION_FIELDS) {
        if (key in perms && perms[key] !== undefined && typeof perms[key] !== "boolean") {
          issues.push(
            issue(
              "MISSING_REQUIRED_FIELD",
              `permissions.${key}`,
              `"permissions.${key}" must be a boolean when provided`,
            ),
          )
        }
      }
    }
  }

  // entry — optional, must be a safe relative path
  if ("entry" in obj && obj.entry !== undefined) {
    if (typeof obj.entry !== "string") {
      issues.push(issue("INVALID_ENTRY_PATH", "entry", '"entry" must be a string when provided'))
    } else if (!isSafePluginRelativePath(obj.entry)) {
      issues.push(
        issue(
          "INVALID_ENTRY_PATH",
          "entry",
          `"entry" must be a safe relative path (no traversal, no absolute path) (got: "${obj.entry}")`,
        ),
      )
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues }
  }

  const manifest: BoringPluginManifest = {
    id: obj.id as string,
    version: obj.version as string,
  }
  if (typeof obj.label === "string") manifest.label = obj.label
  if (typeof obj.description === "string") manifest.description = obj.description
  if (typeof obj.runtime === "string") manifest.runtime = obj.runtime as BoringPluginRuntime
  if (obj.permissions && typeof obj.permissions === "object") {
    const perms = obj.permissions as Record<string, unknown>
    const result: BoringPluginPermissions = {}
    if (typeof perms.panels === "boolean") result.panels = perms.panels
    if (typeof perms.commands === "boolean") result.commands = perms.commands
    if (typeof perms.surfaceResolvers === "boolean") result.surfaceResolvers = perms.surfaceResolvers
    if (typeof perms.providers === "boolean") result.providers = perms.providers
    manifest.permissions = result
  }
  if (typeof obj.entry === "string") manifest.entry = obj.entry

  return { valid: true, manifest }
}
