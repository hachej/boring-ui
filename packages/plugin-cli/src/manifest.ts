/**
 * Canonical package.json plugin shape for boring-ui workspace packages.
 *
 * Browser-safe: no node:* imports, no fs, no path.
 *
 * A plugin package has one package boundary and two namespaces:
 * - `pi`: agent/Pi runtime contributions (extensions, skills, prompt, Pi packages)
 * - `boring`: workspace/UI package discovery (front/server entrypoints and labels)
 */

export interface BoringPackageBoringField {
  /** Optional stable plugin id. Defaults to package.json#name normalized for package discovery. */
  id?: string
  /** Browser entry that default-exports a BoringFrontFactory. */
  front?: string
  /** Workspace/UI support server entry. Set false to disable convention lookup. */
  server?: string | false
  label?: string
}

export interface BoringPackagePiSourceObject {
  source: string
  extensions?: string[]
  skills?: string[]
  themes?: string[]
  prompts?: string[]
}

export type BoringPackagePiSource = string | BoringPackagePiSourceObject

export interface BoringPackagePiField {
  /** Native Pi extension entrypoints, relative to the package root. */
  extensions?: string[]
  /** Skill directories/files, relative to the package root. */
  skills?: string[]
  /** Additional Pi package sources to inject into Pi settings. */
  packages?: BoringPackagePiSource[]
  /** Agent context injected by the boring Pi extension. Prefer skills for large docs. */
  systemPrompt?: string
}

export interface BoringPluginPackageJson {
  name?: string
  version?: string
  boring?: BoringPackageBoringField
  pi?: BoringPackagePiField
}

export type BoringPluginManifestErrorCode =
  | "INVALID_ID"
  | "INVALID_VERSION"
  | "INVALID_FIELD"
  | "INVALID_PATH"
  | "MISSING_REQUIRED_FIELD"

export interface BoringPluginManifestIssue {
  code: BoringPluginManifestErrorCode
  field: string
  message: string
}

export type BoringPluginManifestValidationResult =
  | { valid: true; packageJson: BoringPluginPackageJson }
  | { valid: false; issues: BoringPluginManifestIssue[] }

const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/** Package plugin ids allow npm-ish ids after package-name normalization. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

export function isValidBoringPluginId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && PLUGIN_ID_RE.test(id)
}

export function isSafePluginRelativePath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.startsWith("//") &&
    !/^[A-Za-z]:[\\/]/.test(value) &&
    !value.split("/").includes("..")
  )
}

function issue(
  code: BoringPluginManifestErrorCode,
  field: string,
  message: string,
): BoringPluginManifestIssue {
  return { code, field, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validateStringArray(
  issues: BoringPluginManifestIssue[],
  value: unknown,
  field: string,
  pathLike: boolean,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    issues.push(issue("INVALID_FIELD", field, `${field} must be an array`))
    return
  }
  value.forEach((entry, index) => {
    const itemField = `${field}[${index}]`
    if (typeof entry !== "string" || entry.length === 0) {
      issues.push(issue("INVALID_FIELD", itemField, `${itemField} must be a non-empty string`))
      return
    }
    if (pathLike && !isSafePluginRelativePath(entry)) {
      issues.push(issue("INVALID_PATH", itemField, `${itemField} must be a safe relative path`))
    }
  })
}

const REMOVED_BORING_UI_FIELDS = ["outputs", "panels", "commands", "leftTabs", "surfaceResolvers", "providers", "bindings", "catalogs"] as const

function validateBoringField(
  issues: BoringPluginManifestIssue[],
  boring: unknown,
): BoringPackageBoringField | undefined {
  if (boring === undefined) return undefined
  if (!isRecord(boring)) {
    issues.push(issue("INVALID_FIELD", "boring", "boring must be an object when provided"))
    return undefined
  }
  for (const field of REMOVED_BORING_UI_FIELDS) {
    if (boring[field] !== undefined) {
      issues.push(issue(
        "INVALID_FIELD",
        `boring.${field}`,
        `boring.${field} is not supported; declare front contributions in boring.front via definePlugin({ ... })`,
      ))
    }
  }
  if (boring.id !== undefined && (typeof boring.id !== "string" || !isValidBoringPluginId(boring.id))) {
    issues.push(issue("INVALID_ID", "boring.id", "boring.id must start with a letter or number and use only letters, numbers, dot, underscore, colon, or dash"))
  }
  const front = boring.front
  if (front !== undefined && (typeof front !== "string" || !isSafePluginRelativePath(front))) {
    issues.push(issue("INVALID_PATH", "boring.front", "boring.front must be a safe relative path"))
  }
  const server = boring.server
  if (server !== undefined && server !== false && (typeof server !== "string" || !isSafePluginRelativePath(server))) {
    issues.push(issue("INVALID_PATH", "boring.server", "boring.server must be a safe relative path or false"))
  }
  if (boring.label !== undefined && typeof boring.label !== "string") {
    issues.push(issue("INVALID_FIELD", "boring.label", "boring.label must be a string when provided"))
  }
  return {
    ...(typeof boring.id === "string" ? { id: boring.id } : {}),
    ...(typeof boring.front === "string" ? { front: boring.front } : {}),
    ...(typeof boring.server === "string" || boring.server === false ? { server: boring.server } : {}),
    ...(typeof boring.label === "string" ? { label: boring.label } : {}),
  }
}

const REMOTE_PI_PACKAGE_PREFIXES = ["npm:", "git:", "github:", "http:", "https:", "ssh:"]

function isRemotePiPackageSource(value: string): boolean {
  return REMOTE_PI_PACKAGE_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function isSafePiPackageSource(value: string): boolean {
  if (value.length === 0) return false
  if (isRemotePiPackageSource(value)) return true
  const path = value.startsWith("file:") ? value.slice("file:".length) : value
  if (path === "." || path === "./") return true
  const normalized = path.startsWith("./") ? path.slice(2) : path
  return isSafePluginRelativePath(normalized)
}

function validatePiPackages(
  issues: BoringPluginManifestIssue[],
  value: unknown,
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    issues.push(issue("INVALID_FIELD", "pi.packages", "pi.packages must be an array when provided"))
    return
  }
  value.forEach((entry, index) => {
    const field = `pi.packages[${index}]`
    if (typeof entry === "string") {
      if (!isSafePiPackageSource(entry)) {
        issues.push(issue("INVALID_PATH", field, `${field} must be a safe package source`))
      }
      return
    }
    if (!isRecord(entry)) {
      issues.push(issue("INVALID_FIELD", field, `${field} must be a string or package source object`))
      return
    }
    if (typeof entry.source !== "string" || entry.source.length === 0) {
      issues.push(issue("INVALID_FIELD", `${field}.source`, `${field}.source must be a non-empty string`))
    } else if (!isSafePiPackageSource(entry.source)) {
      issues.push(issue("INVALID_PATH", `${field}.source`, `${field}.source must be a safe package source`))
    }
    // Pi owns package resource filter validation. Boring only guards the
    // package source because local plugin-relative sources are rebased by the
    // workspace server before being forwarded to Pi.
  })
}

function validatePiField(
  issues: BoringPluginManifestIssue[],
  pi: unknown,
): BoringPackagePiField | undefined {
  if (pi === undefined) return undefined
  if (!isRecord(pi)) {
    issues.push(issue("INVALID_FIELD", "pi", "pi must be an object when provided"))
    return undefined
  }
  validateStringArray(issues, pi.extensions, "pi.extensions", true)
  validateStringArray(issues, pi.skills, "pi.skills", true)
  validatePiPackages(issues, pi.packages)
  if (pi.systemPrompt !== undefined && typeof pi.systemPrompt !== "string") {
    issues.push(issue("INVALID_FIELD", "pi.systemPrompt", "pi.systemPrompt must be a string when provided"))
  }
  return pi as BoringPackagePiField
}

export function validateBoringPluginManifest(
  raw: unknown,
): BoringPluginManifestValidationResult {
  const issues: BoringPluginManifestIssue[] = []
  if (!isRecord(raw)) {
    return {
      valid: false,
      issues: [issue("INVALID_FIELD", "<root>", "package.json manifest must be an object")],
    }
  }

  if (raw.name !== undefined && typeof raw.name !== "string") {
    issues.push(issue("INVALID_FIELD", "name", "name must be a string when provided"))
  }
  if (raw.version !== undefined && typeof raw.version !== "string") {
    issues.push(issue("INVALID_VERSION", "version", "version must be a string when provided"))
  } else if (typeof raw.version === "string" && raw.version.length > 0 && !SEMVER_RE.test(raw.version)) {
    issues.push(issue("INVALID_VERSION", "version", "version must be a valid semver string"))
  }

  const boring = validateBoringField(issues, raw.boring)
  const pi = validatePiField(issues, raw.pi)
  if (!boring && !pi) {
    issues.push(issue("MISSING_REQUIRED_FIELD", "boring|pi", "package.json must include boring and/or pi plugin metadata"))
  }

  if (issues.length > 0) return { valid: false, issues }
  return {
    valid: true,
    packageJson: {
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.version === "string" ? { version: raw.version } : {}),
      ...(boring ? { boring } : {}),
      ...(pi ? { pi } : {}),
    },
  }
}
