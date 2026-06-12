import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { validateBoringPluginManifest } from "../manifest"

export type PluginInstallScope = "local" | "global"
export type PluginSourceKind = "local" | "git" | "npm"

export interface PluginSourceRecord {
  id: string
  kind: PluginSourceKind
  scope: PluginInstallScope
  /** Pi package source entry as stored in settings.json. */
  packageSource: string
  /** Resolved package root when the source is locally inspectable. */
  source: string
  rootDir: string
  packageName?: string
  version?: string
  ref?: string
}

export interface PluginSourceScopePaths {
  scope: PluginInstallScope
  workspaceRoot?: string
  baseDir: string
  extensionsDir: string
  gitDir: string
  npmDir: string
  settingsPath: string
}

export interface InstallPluginSourceOptions {
  source: string
  scope?: PluginInstallScope
  workspaceRoot?: string
  globalRoot?: string
}

export interface RemovePluginSourceOptions {
  target: string
  scope?: PluginInstallScope
  workspaceRoot?: string
  globalRoot?: string
}

export interface ListPluginSourcesOptions {
  scope?: PluginInstallScope | "all"
  workspaceRoot?: string
  globalRoot?: string
}

export interface PluginInstallResult {
  record: PluginSourceRecord
  scopePaths: PluginSourceScopePaths
  dependencyHints: string[]
  replaced: boolean
}

export interface PluginRemoveResult {
  record: PluginSourceRecord
  scopePaths: PluginSourceScopePaths
  removedSourceDir: boolean
}

export interface PluginListResult {
  records: PluginSourceRecord[]
  scopes: PluginSourceScopePaths[]
}

interface PiSettingsFile {
  packages?: unknown
  [key: string]: unknown
}

type PiPackageEntry = string | { source?: string; [key: string]: unknown }

type ClassifiedSource =
  | { kind: "local"; spec: string; original: string }
  | { kind: "git"; spec: string; original: string; ref?: string }
  | { kind: "npm"; spec: string; original: string }

function defaultWorkspaceRoot(): string {
  return process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd()
}

function defaultGlobalRoot(): string {
  return process.env.BORING_UI_PLUGIN_GLOBAL_ROOT ?? join(homedir(), ".pi", "agent")
}

export function resolvePluginSourceScopePaths(
  scope: PluginInstallScope,
  opts: { workspaceRoot?: string; globalRoot?: string } = {},
): PluginSourceScopePaths {
  if (scope === "global") {
    const baseDir = resolve(opts.globalRoot ?? defaultGlobalRoot())
    return {
      scope,
      baseDir,
      extensionsDir: join(baseDir, "extensions"),
      gitDir: join(baseDir, "git"),
      npmDir: join(baseDir, "npm"),
      settingsPath: join(baseDir, "settings.json"),
    }
  }

  const workspaceRoot = resolve(opts.workspaceRoot ?? defaultWorkspaceRoot())
  const baseDir = join(workspaceRoot, ".pi")
  return {
    scope,
    workspaceRoot,
    baseDir,
    extensionsDir: join(baseDir, "extensions"),
    gitDir: join(baseDir, "git"),
    npmDir: join(baseDir, "npm"),
    settingsPath: join(baseDir, "settings.json"),
  }
}

function ensureScopeDirs(paths: PluginSourceScopePaths): void {
  mkdirSync(paths.baseDir, { recursive: true })
  mkdirSync(paths.extensionsDir, { recursive: true })
  mkdirSync(paths.gitDir, { recursive: true })
  mkdirSync(paths.npmDir, { recursive: true })
}

function readPiSettings(settingsPath: string): PiSettingsFile {
  if (!existsSync(settingsPath)) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid Pi settings file ${settingsPath}: ${message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid Pi settings file ${settingsPath}: expected object`)
  }
  return parsed as PiSettingsFile
}

function writePiSettings(settingsPath: string, settings: PiSettingsFile): void {
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

function packageEntries(settings: PiSettingsFile): PiPackageEntry[] {
  if (!Array.isArray(settings.packages)) return []
  return settings.packages.flatMap((entry): PiPackageEntry[] => {
    if (typeof entry === "string") return [entry]
    if (entry && typeof entry === "object" && !Array.isArray(entry)) return [entry as PiPackageEntry]
    return []
  })
}

function packageEntrySource(entry: PiPackageEntry): string | undefined {
  return typeof entry === "string" ? entry : typeof entry.source === "string" ? entry.source : undefined
}

function resolveMaybePath(value: string): string {
  if (value === "~") return homedir()
  if (value.startsWith("~/")) return resolve(join(homedir(), value.slice(2)))
  if (isAbsolute(value) || value.startsWith(".")) return resolve(value)
  return value
}

function resolvePackageSourcePath(settingsDir: string, source: string): string | undefined {
  const path = source.startsWith("file:") ? source.slice("file:".length) : source
  if (path.startsWith("npm:") || path.startsWith("git:") || path.startsWith("github:") || /^(https?|ssh):\/\//.test(path)) return undefined
  if (path === "~" || path.startsWith("~/")) return resolveMaybePath(path)
  return isAbsolute(path) ? resolve(path) : resolve(settingsDir, path)
}

function pathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel))
}

function sourceForLocalPackage(paths: PluginSourceScopePaths, rootDir: string): string {
  if (paths.workspaceRoot && pathInside(paths.workspaceRoot, rootDir)) {
    const rel = relative(paths.baseDir, rootDir).split("\\").join("/")
    if (!rel || rel === ".") return "."
    return rel.startsWith(".") ? rel : rel.startsWith("..") ? rel : `./${rel}`
  }
  const rel = relative(paths.baseDir, rootDir).split("\\").join("/")
  if (!rel || rel === ".") return "."
  if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.startsWith(".") ? rel : `./${rel}`
  return rootDir
}

function inferKind(paths: PluginSourceScopePaths, rootDir: string, source: string): PluginSourceKind {
  if (source.startsWith("npm:") || pathInside(paths.npmDir, rootDir)) return "npm"
  if (source.startsWith("git:") || source.startsWith("github:") || /^(https?|ssh):\/\//.test(source) || pathInside(paths.gitDir, rootDir)) return "git"
  return "local"
}

function run(command: string, args: string[], opts: { cwd?: string } = {}): void {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status === 0) return
  const stderr = result.stderr?.trim()
  const stdout = result.stdout?.trim()
  const details = stderr || stdout ? `: ${stderr || stdout}` : ""
  throw new Error(`${command} ${args.join(" ")} failed${details}`)
}

function runWithStdout(command: string, args: string[], opts: { cwd?: string } = {}): string {
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    const stdout = result.stdout?.trim()
    const details = stderr || stdout ? `: ${stderr || stdout}` : ""
    throw new Error(`${command} ${args.join(" ")} failed${details}`)
  }
  return result.stdout
}

function readPackageJson(pluginRoot: string): Record<string, unknown> {
  const pkgPath = join(pluginRoot, "package.json")
  if (!existsSync(pkgPath)) throw new Error(`package.json missing in plugin source: ${pluginRoot}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`package.json is not valid JSON in ${pluginRoot}: ${message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`package.json must be an object in ${pluginRoot}`)
  }
  return parsed as Record<string, unknown>
}

function pluginIdFromPackageJson(pkg: Record<string, unknown>, rootDir: string): string {
  const boring = pkg.boring && typeof pkg.boring === "object" && !Array.isArray(pkg.boring)
    ? pkg.boring as Record<string, unknown>
    : undefined
  const pi = pkg.pi && typeof pkg.pi === "object" && !Array.isArray(pkg.pi)
    ? pkg.pi as Record<string, unknown>
    : undefined
  const explicitId = typeof boring?.id === "string" && boring.id.trim()
    ? boring.id.trim()
    : typeof pi?.id === "string" && pi.id.trim()
      ? pi.id.trim()
      : undefined
  if (explicitId) return explicitId
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined
  return ((name ?? basename(rootDir)) || "plugin").replace(/^@/, "").replaceAll("/", "-")
}

function validateInstallablePluginRoot(pluginRoot: string): { id: string; packageName?: string; version?: string; dependencyHints: string[] } {
  const resolvedRoot = resolve(pluginRoot)
  const pkg = readPackageJson(resolvedRoot)
  const validation = validateBoringPluginManifest(pkg)
  if (!validation.valid) {
    const issues = validation.issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")
    throw new Error(`invalid Boring plugin manifest in ${resolvedRoot}: ${issues}`)
  }
  const id = pluginIdFromPackageJson(validation.packageJson as unknown as Record<string, unknown>, resolvedRoot)
  return {
    id,
    ...(typeof validation.packageJson.name === "string" ? { packageName: validation.packageJson.name } : {}),
    ...(typeof validation.packageJson.version === "string" ? { version: validation.packageJson.version } : {}),
    dependencyHints: dependencyHints(resolvedRoot, pkg),
  }
}

/**
 * Packages the workspace host always supplies at runtime. A plugin must resolve
 * these from the host, never from a copy inside its own tree — a second React in
 * particular causes dual-React / invalid-hook-call crashes. We never report them
 * as missing, and `installPluginDependencies` strips them from the plugin's own
 * `dependencies` before installing so npm can't pull a shadow copy even when a
 * plugin lists them under `dependencies` instead of `peerDependencies`. (This
 * covers the plugin's direct deps; a transitive dep that wrongly declares React
 * under `dependencies` rather than `peerDependencies` could still hoist a copy —
 * `--legacy-peer-deps` plus the React-as-peer convention is what guards that.)
 */
const HOST_PROVIDED_DEPENDENCIES = new Set(["react", "react-dom", "@hachej/boring-workspace", "@hachej/boring-ui-kit"])

function dependencyHints(pluginRoot: string, pkg: Record<string, unknown>): string[] {
  const dependencies = pkg.dependencies
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return []
  const hints: string[] = []
  for (const dep of Object.keys(dependencies)) {
    if (HOST_PROVIDED_DEPENDENCIES.has(dep)) continue
    const depDir = dep.startsWith("@") ? join(pluginRoot, "node_modules", ...dep.split("/")) : join(pluginRoot, "node_modules", dep)
    if (!existsSync(depDir)) hints.push(`Missing dependency: ${dep}\nRun: cd ${pluginRoot} && npm install`)
  }
  return hints
}

function classifySource(source: string): ClassifiedSource {
  if (source.startsWith("npm:")) return { kind: "npm", spec: source.slice("npm:".length), original: source }
  if (source.startsWith("git:")) return { ...normalizeGitSource(source.slice("git:".length)), original: source }
  if (source.startsWith("github:")) return { ...normalizeGitSource(source), original: source }
  if (/^(https?|ssh):\/\//.test(source)) return { kind: "git", spec: source, original: source }
  const maybePath = resolveMaybePath(source)
  if (existsSync(maybePath)) return { kind: "local", spec: maybePath, original: source }
  throw new Error(`unsupported plugin source ${JSON.stringify(source)}. Use a local path, npm:<package>, git:<repo>, github:<owner>/<repo>, or an http(s) git URL.`)
}

function normalizeGitSource(raw: string): { kind: "git"; spec: string; ref?: string } {
  let spec = raw
  let ref: string | undefined
  const hashIndex = spec.lastIndexOf("#")
  if (hashIndex > 0) {
    ref = spec.slice(hashIndex + 1)
    spec = spec.slice(0, hashIndex)
  } else {
    const slashIndex = spec.lastIndexOf("/")
    const atIndex = spec.lastIndexOf("@")
    if (atIndex > slashIndex && !spec.slice(0, atIndex).includes(":")) {
      ref = spec.slice(atIndex + 1)
      spec = spec.slice(0, atIndex)
    }
  }
  if (spec.startsWith("github:")) spec = `https://github.com/${spec.slice("github:".length)}`
  if (spec.startsWith("github.com/")) spec = `https://${spec}`
  return { kind: "git", spec, ...(ref ? { ref } : {}) }
}

function safeInstallDir(parent: string, id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._:-]+/g, "-")
  if (!cleaned || cleaned === "." || cleaned === "..") throw new Error(`invalid plugin id ${JSON.stringify(id)}`)
  return join(parent, cleaned)
}

// Promote a staged package to its final path. Callers stage inside the
// destination's own parent dir (see withStagingDir), so `from` and `to` are
// always on the same filesystem and this rename can't hit EXDEV.
function moveFreshDir(from: string, to: string): void {
  if (existsSync(to)) throw new Error(`plugin install target already exists: ${to}. Remove it first with boring-ui-plugin remove ${basename(to)}`)
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

function installLocalSource(source: string, paths: PluginSourceScopePaths): { rootDir: string; packageSource: string; ref?: string } {
  const rootDir = realpathSync(resolveMaybePath(source))
  return { rootDir, packageSource: sourceForLocalPackage(paths, rootDir) }
}

/**
 * Install a freshly placed plugin package's declared dependencies into its own
 * `node_modules`, the same way Pi installs package sources: delegate to the
 * package manager rather than shipping a bare tarball. Runs at the FINAL install
 * path (not in staging) so package-manager-authored relative symlinks — e.g.
 * `file:` deps — resolve correctly and survive.
 *
 * Host-provided packages are stripped from the manifest first so npm cannot pull
 * a shadow copy into the plugin tree; the workspace supplies them at runtime.
 * Rolls the package back out on failure so a partial install never lingers.
 * Local-path sources are excluded by the caller: those reference an editable tree
 * the author owns and must not be mutated.
 */
function installPluginDependencies(pluginRoot: string): void {
  const pkg = readPackageJson(pluginRoot)
  const declared = pkg.dependencies
  if (!declared || typeof declared !== "object" || Array.isArray(declared)) return
  const installable = Object.fromEntries(
    Object.entries(declared).filter(([name]) => !HOST_PROVIDED_DEPENDENCIES.has(name)),
  )
  if (Object.keys(installable).length === 0) return
  if (Object.keys(installable).length !== Object.keys(declared).length) {
    writeFileSync(
      join(pluginRoot, "package.json"),
      `${JSON.stringify({ ...pkg, dependencies: installable }, null, 2)}\n`,
      "utf8",
    )
  }
  try {
    // Scripts run (no --ignore-scripts), matching Pi: install lifecycle scripts of
    // the plugin and its deps execute here. The install path already warns that
    // plugins are trusted local code.
    run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--legacy-peer-deps"], { cwd: pluginRoot })
  } catch (err) {
    // Deps are mandatory for npm/git sources (a plugin missing them won't load),
    // so a failed install is a failed install: roll the package back out — leaving
    // no settings entry and no half-placed dir — rather than register a broken
    // plugin. Re-run the install once the registry is reachable again.
    rmSync(pluginRoot, { recursive: true, force: true })
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`failed to install dependencies for plugin at ${pluginRoot}; install rolled back. ${detail}`)
  }
}

/**
 * Stage a fetched package next to its final destination (inside the scope's
 * git/npm root, on the same filesystem) so promoting it is an atomic rename.
 * The previous implementation staged under the OS temp dir and renamed across
 * mounts, which throws EXDEV whenever `/tmp` is a separate filesystem (tmpfs,
 * Docker, most CI) — i.e. the common case.
 */
function withStagingDir<T>(parent: string, fn: (stagingDir: string) => T): T {
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, ".staging-"))
  try {
    return fn(staging)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function installGitSource(spec: string, paths: PluginSourceScopePaths, ref?: string): { rootDir: string; packageSource: string; ref?: string } {
  return withStagingDir(paths.gitDir, (staging) => {
    const cloneDir = join(staging, "repo")
    run("git", ["clone", "--quiet", spec, cloneDir])
    if (ref) run("git", ["checkout", "--quiet", ref], { cwd: cloneDir })
    const meta = validateInstallablePluginRoot(cloneDir)
    const target = safeInstallDir(paths.gitDir, meta.id)
    moveFreshDir(cloneDir, target)
    installPluginDependencies(target)
    return { rootDir: target, packageSource: sourceForLocalPackage(paths, target), ...(ref ? { ref } : {}) }
  })
}

function installNpmSource(spec: string, paths: PluginSourceScopePaths): { rootDir: string; packageSource: string } {
  return withStagingDir(paths.npmDir, (staging) => {
    const packDir = join(staging, "pack")
    const extractDir = join(staging, "extract")
    mkdirSync(packDir, { recursive: true })
    mkdirSync(extractDir, { recursive: true })
    const stdout = runWithStdout("npm", ["pack", "--silent", spec, "--pack-destination", packDir], { cwd: staging })
    const tarballName = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!tarballName) throw new Error(`npm pack did not produce a tarball for ${spec}`)
    const tarball = isAbsolute(tarballName) ? tarballName : join(packDir, tarballName)
    run("tar", ["-xzf", tarball, "-C", extractDir, "--strip-components", "1"])
    const meta = validateInstallablePluginRoot(extractDir)
    const target = safeInstallDir(paths.npmDir, meta.id)
    moveFreshDir(extractDir, target)
    installPluginDependencies(target)
    return { rootDir: target, packageSource: sourceForLocalPackage(paths, target) }
  })
}

function recordFromPackageSource(paths: PluginSourceScopePaths, entry: PiPackageEntry): PluginSourceRecord | null {
  const packageSource = packageEntrySource(entry)
  if (!packageSource) return null
  const rootDir = resolvePackageSourcePath(paths.baseDir, packageSource)
  if (!rootDir || !existsSync(join(rootDir, "package.json"))) return null
  const meta = validateInstallablePluginRoot(rootDir)
  return {
    id: meta.id,
    kind: inferKind(paths, rootDir, packageSource),
    scope: paths.scope,
    packageSource,
    source: rootDir,
    rootDir,
    ...(meta.packageName ? { packageName: meta.packageName } : {}),
    ...(meta.version ? { version: meta.version } : {}),
  }
}

export function readPluginSourceRecords(paths: PluginSourceScopePaths): PluginSourceRecord[] {
  return packageEntries(readPiSettings(paths.settingsPath)).flatMap((entry) => {
    try {
      const record = recordFromPackageSource(paths, entry)
      return record ? [record] : []
    } catch {
      return []
    }
  })
}

export function readPluginSourceRecordsForRoots(opts: {
  workspaceRoot: string
  globalRoot?: string
}): PluginSourceRecord[] {
  const local = resolvePluginSourceScopePaths("local", opts)
  const global = resolvePluginSourceScopePaths("global", opts)
  return [...readPluginSourceRecords(global), ...readPluginSourceRecords(local)]
}

export interface RegisteredPluginSourceDir {
  /** Raw package source string as written in settings.json. */
  source: string
  /** Absolute directory the source resolves to (may not exist). */
  rootDir: string
}

/**
 * Resolve every local-path `packages` entry in the scope's settings.json
 * to its directory WITHOUT validating the plugin root. Remote specs
 * (npm:, git:, URLs) are skipped — their installed copies live under the
 * scope's npm/git dirs, which hosts already scan directly.
 *
 * Unlike `readPluginSourceRecords`, broken entries are returned rather
 * than dropped: hosts pass these dirs to the Boring plugin scanner with
 * `registered: true`, so a deleted dir or stripped package.json surfaces
 * as a preflight error in the plugin UI instead of the plugin silently
 * vanishing.
 */
export function resolveRegisteredPluginSourceDirs(paths: PluginSourceScopePaths): RegisteredPluginSourceDir[] {
  return packageEntries(readPiSettings(paths.settingsPath)).flatMap((entry) => {
    const source = packageEntrySource(entry)
    if (!source) return []
    const rootDir = resolvePackageSourcePath(paths.baseDir, source)
    return rootDir ? [{ source, rootDir }] : []
  })
}

function upsertPackageSource(paths: PluginSourceScopePaths, record: PluginSourceRecord): boolean {
  const settings = readPiSettings(paths.settingsPath)
  const entries = packageEntries(settings)
  let replaced = false
  const nextEntries: PiPackageEntry[] = []
  for (const entry of entries) {
    const existing = recordFromPackageSource(paths, entry)
    const existingSource = packageEntrySource(entry)
    if (existing?.id === record.id || existing?.rootDir === record.rootDir || existingSource === record.packageSource) {
      replaced = true
      continue
    }
    nextEntries.push(entry)
  }
  nextEntries.push(record.packageSource)
  settings.packages = nextEntries
  writePiSettings(paths.settingsPath, settings)
  return replaced
}

function removePackageSource(paths: PluginSourceScopePaths, target: string): PluginSourceRecord | null {
  const settings = readPiSettings(paths.settingsPath)
  const entries = packageEntries(settings)
  const resolvedTarget = resolveMaybePath(target)
  let removed: PluginSourceRecord | null = null
  const nextEntries: PiPackageEntry[] = []
  for (const entry of entries) {
    const packageSource = packageEntrySource(entry)
    let record: PluginSourceRecord | null = null
    try {
      record = recordFromPackageSource(paths, entry)
    } catch {
      record = null
    }
    const rootDir = packageSource ? resolvePackageSourcePath(paths.baseDir, packageSource) : undefined
    const matches = record
      ? record.id === target
        || record.packageSource === target
        || record.source === target
        || record.rootDir === target
        || record.source === resolvedTarget
        || record.rootDir === resolvedTarget
      : packageSource === target
        || rootDir === target
        || rootDir === resolvedTarget
    if (matches && !removed) {
      removed = record ?? (packageSource ? {
        id: target,
        kind: rootDir ? inferKind(paths, rootDir, packageSource) : "local",
        scope: paths.scope,
        packageSource,
        source: rootDir ?? packageSource,
        rootDir: rootDir ?? packageSource,
      } : null)
      continue
    }
    if (matches) {
      continue
    }
    nextEntries.push(entry)
  }
  if (!removed) return null
  settings.packages = nextEntries
  writePiSettings(paths.settingsPath, settings)
  return removed
}

export function installPluginSource(opts: InstallPluginSourceOptions): PluginInstallResult {
  const scope = opts.scope ?? "local"
  const paths = resolvePluginSourceScopePaths(scope, opts)
  ensureScopeDirs(paths)
  const classified = classifySource(opts.source)
  const installed: { rootDir: string; packageSource: string; ref?: string } = classified.kind === "local"
    ? installLocalSource(classified.spec, paths)
    : classified.kind === "git"
      ? installGitSource(classified.spec, paths, classified.ref)
      : installNpmSource(classified.spec, paths)
  const meta = validateInstallablePluginRoot(installed.rootDir)
  const record: PluginSourceRecord = {
    id: meta.id,
    kind: classified.kind,
    scope,
    packageSource: installed.packageSource,
    source: installed.rootDir,
    rootDir: installed.rootDir,
    ...(meta.packageName ? { packageName: meta.packageName } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(installed.ref ? { ref: installed.ref } : {}),
  }
  const replaced = upsertPackageSource(paths, record)
  return { record, scopePaths: paths, dependencyHints: meta.dependencyHints, replaced }
}

export function listPluginSources(opts: ListPluginSourcesOptions = {}): PluginListResult {
  const scopes: PluginSourceScopePaths[] = opts.scope === "all"
    ? [resolvePluginSourceScopePaths("global", opts), resolvePluginSourceScopePaths("local", opts)]
    : [resolvePluginSourceScopePaths(opts.scope ?? "local", opts)]
  return {
    scopes,
    records: scopes.flatMap((paths) => readPluginSourceRecords(paths)),
  }
}

export function removePluginSource(opts: RemovePluginSourceOptions): PluginRemoveResult {
  const scope = opts.scope ?? "local"
  const paths = resolvePluginSourceScopePaths(scope, opts)
  const record = removePackageSource(paths, opts.target)
  if (!record) throw new Error(`plugin source not found in ${scope} scope: ${opts.target}`)
  let removedSourceDir = false
  if (record.kind === "git" || record.kind === "npm") {
    const expectedRoot = record.kind === "git" ? paths.gitDir : paths.npmDir
    const resolvedRoot = resolve(record.rootDir)
    if (pathInside(expectedRoot, resolvedRoot)) {
      rmSync(resolvedRoot, { recursive: true, force: true })
      removedSourceDir = true
    }
  }
  return { record, scopePaths: paths, removedSourceDir }
}

export function formatPluginSourceList(result: PluginListResult): string {
  if (result.records.length === 0) {
    const scopes = result.scopes.map((scope) => scope.scope).join("+")
    return `No plugins installed in ${scopes} scope.`
  }
  return result.records
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id))
    .map((record) => `${record.id}\n  scope  ${record.scope}\n  kind   ${record.kind}\n  source ${record.packageSource}\n  dir    ${record.rootDir}`)
    .join("\n")
}
