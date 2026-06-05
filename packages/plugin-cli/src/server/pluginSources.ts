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
import { homedir, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { validateBoringPluginManifest } from "../manifest"

export type PluginInstallScope = "local" | "global"
export type PluginSourceKind = "local" | "git" | "npm"

export interface PluginSourceRecord {
  id: string
  kind: PluginSourceKind
  scope: PluginInstallScope
  source: string
  rootDir: string
  installedAt: string
  packageName?: string
  version?: string
  ref?: string
  rootDirRelativeToWorkspace?: string
  sourceRelativeToWorkspace?: string
}

interface PluginSourceRecordsFile {
  version: 1
  sources: PluginSourceRecord[]
}

export interface PluginSourceScopePaths {
  scope: PluginInstallScope
  workspaceRoot?: string
  baseDir: string
  extensionsDir: string
  gitDir: string
  npmDir: string
  recordsPath: string
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
      recordsPath: join(baseDir, "boring-plugin-sources.json"),
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
    recordsPath: join(baseDir, "boring-plugin-sources.json"),
  }
}

function ensureScopeDirs(paths: PluginSourceScopePaths): void {
  mkdirSync(paths.extensionsDir, { recursive: true })
  mkdirSync(paths.gitDir, { recursive: true })
  mkdirSync(paths.npmDir, { recursive: true })
  mkdirSync(dirname(paths.recordsPath), { recursive: true })
}

function readRecordsFile(recordsPath: string): PluginSourceRecordsFile {
  if (!existsSync(recordsPath)) return { version: 1, sources: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(recordsPath, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid plugin source records file ${recordsPath}: ${message}`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid plugin source records file ${recordsPath}: expected object`)
  }
  const obj = parsed as Record<string, unknown>
  if (obj.version !== 1 || !Array.isArray(obj.sources)) {
    throw new Error(`invalid plugin source records file ${recordsPath}: unsupported format`)
  }
  const sources: PluginSourceRecord[] = []
  for (const entry of obj.sources) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== "string"
      || !["local", "git", "npm"].includes(String(record.kind))
      || !["local", "global"].includes(String(record.scope))
      || typeof record.source !== "string"
      || typeof record.rootDir !== "string"
      || typeof record.installedAt !== "string"
    ) continue
    sources.push({
      id: record.id,
      kind: record.kind as PluginSourceKind,
      scope: record.scope as PluginInstallScope,
      source: record.source,
      rootDir: record.rootDir,
      installedAt: record.installedAt,
      ...(typeof record.packageName === "string" ? { packageName: record.packageName } : {}),
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      ...(typeof record.ref === "string" ? { ref: record.ref } : {}),
      ...(typeof record.rootDirRelativeToWorkspace === "string" ? { rootDirRelativeToWorkspace: record.rootDirRelativeToWorkspace } : {}),
      ...(typeof record.sourceRelativeToWorkspace === "string" ? { sourceRelativeToWorkspace: record.sourceRelativeToWorkspace } : {}),
    })
  }
  return { version: 1, sources }
}

function writeRecordsFile(recordsPath: string, file: PluginSourceRecordsFile): void {
  mkdirSync(dirname(recordsPath), { recursive: true })
  writeFileSync(recordsPath, `${JSON.stringify(file, null, 2)}\n`, "utf8")
}

function isWorkspaceRelativePath(value: string): boolean {
  return value === "." || (!isAbsolute(value) && !value.split(/[\\/]/).includes(".."))
}

function pathRelativeToWorkspace(workspaceRoot: string | undefined, value: string): string | undefined {
  if (!workspaceRoot) return undefined
  const rel = relative(workspaceRoot, value)
  if (!rel || rel === ".") return "."
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined
  return rel.split("\\").join("/")
}

function resolveWorkspacePath(paths: PluginSourceScopePaths, value: string, relativeValue?: string): string | null {
  if (paths.scope !== "local" || !paths.workspaceRoot) return value
  if (relativeValue !== undefined) return isWorkspaceRelativePath(relativeValue) ? resolve(paths.workspaceRoot, relativeValue) : null
  if (value === "/workspace") return resolve(paths.workspaceRoot)
  if (value.startsWith("/workspace/")) {
    const workspaceRelativePath = value.slice("/workspace/".length)
    return isWorkspaceRelativePath(workspaceRelativePath) ? resolve(paths.workspaceRoot, workspaceRelativePath) : null
  }
  return value
}

function normalizeRecordForScope(paths: PluginSourceScopePaths, record: PluginSourceRecord): PluginSourceRecord | null {
  if (record.scope !== "local") return record
  const rootDir = resolveWorkspacePath(paths, record.rootDir, record.rootDirRelativeToWorkspace)
  const source = resolveWorkspacePath(paths, record.source, record.sourceRelativeToWorkspace)
  if (!rootDir || !source) return null
  return {
    ...record,
    rootDir,
    source,
  }
}

export function readPluginSourceRecords(paths: PluginSourceScopePaths): PluginSourceRecord[] {
  return readRecordsFile(paths.recordsPath).sources.flatMap((record) => {
    const normalized = normalizeRecordForScope(paths, record)
    return normalized ? [normalized] : []
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

function replaceRecord(paths: PluginSourceScopePaths, record: PluginSourceRecord): boolean {
  const file = readRecordsFile(paths.recordsPath)
  const before = file.sources.length
  file.sources = file.sources.filter((existing) => existing.id !== record.id && existing.source !== record.source)
  const replaced = file.sources.length !== before
  file.sources.push(record)
  file.sources.sort((a, b) => a.scope.localeCompare(b.scope) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source))
  writeRecordsFile(paths.recordsPath, file)
  return replaced
}

function removeRecord(paths: PluginSourceScopePaths, target: string): PluginSourceRecord | null {
  const file = readRecordsFile(paths.recordsPath)
  const resolvedTarget = resolveMaybePath(target)
  const index = file.sources.findIndex((record) => {
    const normalized = normalizeRecordForScope(paths, record)
    return record.id === target
      || record.source === target
      || record.rootDir === resolvedTarget
      || normalized?.source === target
      || normalized?.rootDir === resolvedTarget
  })
  if (index === -1) return null
  const [record] = file.sources.splice(index, 1)
  writeRecordsFile(paths.recordsPath, file)
  if (!record) return null
  return normalizeRecordForScope(paths, record) ?? record
}

function resolveMaybePath(value: string): string {
  if (value.startsWith("~")) return resolve(join(homedir(), value.slice(1)))
  if (isAbsolute(value) || value.startsWith(".")) return resolve(value)
  return value
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
  const explicitId = typeof boring?.id === "string" && boring.id.trim() ? boring.id.trim() : undefined
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

function dependencyHints(pluginRoot: string, pkg: Record<string, unknown>): string[] {
  const dependencies = pkg.dependencies
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return []
  const hints: string[] = []
  for (const dep of Object.keys(dependencies)) {
    if (dep === "react" || dep === "react-dom" || dep === "@hachej/boring-workspace" || dep === "@hachej/boring-ui-kit") continue
    const depDir = dep.startsWith("@") ? join(pluginRoot, "node_modules", ...dep.split("/")) : join(pluginRoot, "node_modules", dep)
    if (!existsSync(depDir)) hints.push(`Missing dependency: ${dep}\nRun: cd ${pluginRoot} && npm install`)
  }
  return hints
}

function classifySource(source: string): { kind: PluginSourceKind; spec: string; ref?: string } {
  if (source.startsWith("npm:")) return { kind: "npm", spec: source.slice("npm:".length) }
  if (source.startsWith("git:")) return normalizeGitSource(source.slice("git:".length))
  if (source.startsWith("github:")) return normalizeGitSource(source)
  if (/^(https?|ssh):\/\//.test(source)) return { kind: "git", spec: source }
  const maybePath = resolveMaybePath(source)
  if (existsSync(maybePath)) return { kind: "local", spec: maybePath }
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

function moveFreshDir(from: string, to: string): void {
  if (existsSync(to)) throw new Error(`plugin install target already exists: ${to}. Remove it first with boring-ui-plugin remove ${basename(to)}`)
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

function installLocalSource(source: string, paths: PluginSourceScopePaths): { rootDir: string; source: string; ref?: string; rootDirRelativeToWorkspace?: string; sourceRelativeToWorkspace?: string } {
  const rootDir = realpathSync(resolveMaybePath(source))
  const relativePath = pathRelativeToWorkspace(paths.workspaceRoot, rootDir)
  return {
    rootDir,
    source: rootDir,
    ...(paths.scope === "local" && relativePath ? {
      rootDirRelativeToWorkspace: relativePath,
      sourceRelativeToWorkspace: relativePath,
    } : {}),
  }
}

function installGitSource(spec: string, paths: PluginSourceScopePaths, ref?: string): { rootDir: string; source: string; ref?: string } {
  const tmp = mkdtempSync(join(tmpdir(), "boring-plugin-git-"))
  const cloneDir = join(tmp, "repo")
  try {
    run("git", ["clone", "--quiet", spec, cloneDir])
    if (ref) run("git", ["checkout", "--quiet", ref], { cwd: cloneDir })
    const meta = validateInstallablePluginRoot(cloneDir)
    const target = safeInstallDir(paths.gitDir, meta.id)
    moveFreshDir(cloneDir, target)
    return { rootDir: target, source: spec, ...(ref ? { ref } : {}) }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function installNpmSource(spec: string, paths: PluginSourceScopePaths): { rootDir: string; source: string } {
  const tmp = mkdtempSync(join(tmpdir(), "boring-plugin-npm-"))
  const packDir = join(tmp, "pack")
  const extractDir = join(tmp, "extract")
  mkdirSync(packDir, { recursive: true })
  mkdirSync(extractDir, { recursive: true })
  try {
    const stdout = runWithStdout("npm", ["pack", "--silent", spec, "--pack-destination", packDir], { cwd: tmp })
    const tarballName = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)
    if (!tarballName) throw new Error(`npm pack did not produce a tarball for ${spec}`)
    const tarball = isAbsolute(tarballName) ? tarballName : join(packDir, tarballName)
    run("tar", ["-xzf", tarball, "-C", extractDir, "--strip-components", "1"])
    const meta = validateInstallablePluginRoot(extractDir)
    const target = safeInstallDir(paths.npmDir, meta.id)
    moveFreshDir(extractDir, target)
    return { rootDir: target, source: spec }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function installPluginSource(opts: InstallPluginSourceOptions): PluginInstallResult {
  const scope = opts.scope ?? "local"
  const paths = resolvePluginSourceScopePaths(scope, opts)
  ensureScopeDirs(paths)
  const classified = classifySource(opts.source)
  const installed: { rootDir: string; source: string; ref?: string; rootDirRelativeToWorkspace?: string; sourceRelativeToWorkspace?: string } = classified.kind === "local"
    ? installLocalSource(classified.spec, paths)
    : classified.kind === "git"
      ? installGitSource(classified.spec, paths, classified.ref)
      : installNpmSource(classified.spec, paths)
  const meta = validateInstallablePluginRoot(installed.rootDir)
  const record: PluginSourceRecord = {
    id: meta.id,
    kind: classified.kind,
    scope,
    source: installed.source,
    rootDir: installed.rootDir,
    installedAt: new Date().toISOString(),
    ...(meta.packageName ? { packageName: meta.packageName } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(installed.ref ? { ref: installed.ref } : {}),
    ...(installed.rootDirRelativeToWorkspace ? { rootDirRelativeToWorkspace: installed.rootDirRelativeToWorkspace } : {}),
    ...(installed.sourceRelativeToWorkspace ? { sourceRelativeToWorkspace: installed.sourceRelativeToWorkspace } : {}),
  }
  const replaced = replaceRecord(paths, record)
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
  const record = removeRecord(paths, opts.target)
  if (!record) throw new Error(`plugin source not found in ${scope} scope: ${opts.target}`)
  let removedSourceDir = false
  if (record.kind === "git" || record.kind === "npm") {
    const expectedRoot = record.kind === "git" ? paths.gitDir : paths.npmDir
    const resolvedRoot = resolve(record.rootDir)
    const rel = resolvedRoot.startsWith(expectedRoot) ? resolvedRoot.slice(expectedRoot.length) : ""
    if (rel.startsWith("/") || rel.startsWith("\\")) {
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
    .map((record) => `${record.id}\n  scope  ${record.scope}\n  kind   ${record.kind}\n  source ${record.source}\n  dir    ${record.rootDir}`)
    .join("\n")
}
