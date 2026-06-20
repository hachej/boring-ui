import { createHash } from "node:crypto"
import type { Lstat, Workspace } from "@hachej/boring-agent/shared"
import {
  BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES,
  BORING_PLUGIN_IFRAME_DOCUMENT_PATH_MAX_LENGTH,
  BORING_PLUGIN_MANIFEST_MAX_BYTES,
  isSafePluginRelativePath,
  isValidBoringPluginId,
  validateBoringPluginManifest,
  type BoringIframePanelManifest,
} from "../../shared/plugins/manifest"
import type { BoringPluginEvent, BoringPluginListEntry, BoringPluginRouteManager } from "../agentPlugins/types"
import { createHostedIframeSrcdoc } from "./srcdoc"

type Listener = (event: BoringPluginEvent) => void

interface HostedRecord extends BoringPluginListEntry {
  rootRel: string
  signature: string
  panelsById: Map<string, BoringIframePanelManifest>
}

export interface HostedPluginManagerOptions {
  workspace: Workspace
}

function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/")
}

function issue(pluginId: string, message: string): BoringPluginEvent {
  return { type: "boring.plugin.error", id: pluginId, revision: Date.now(), message }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function safeHostedErrorMessage(message: string): string {
  const lines = message.split("\n").filter(Boolean)
  const safe = lines.length > 0 && lines.every((line) => /^(HOSTED_PLUGIN_|INVALID_|MISSING_REQUIRED_FIELD|duplicate hosted iframe panel id|duplicate hosted plugin id|boring\.|pi contributions ignored)/.test(line))
  return safe ? lines.join("\n") : "HOSTED_PLUGIN_LOAD_FAILED"
}

function hashSignature(...values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hostedPluginIdFromPackageJson(pkg: { name?: string; boring?: { id?: string } }, rootRel: string): string {
  const explicitId = typeof pkg.boring?.id === "string" && pkg.boring.id.trim() ? pkg.boring.id.trim() : undefined
  if (explicitId) return explicitId
  const name = typeof pkg.name === "string" && pkg.name.trim() ? pkg.name.trim() : undefined
  return (name ?? rootRel.split("/").at(-1) ?? "plugin").replace(/^@/, "").replaceAll("/", "-")
}

export class HostedPluginManager implements BoringPluginRouteManager {
  private records = new Map<string, HostedRecord>()
  private errors = new Map<string, string>()
  private revisionByPlugin = new Map<string, { signature: string; revision: number }>()
  private listeners = new Set<Listener>()
  private loaded = false

  constructor(private readonly options: HostedPluginManagerOptions) {}

  private async lstat(relPath: string): Promise<Lstat> {
    if (!this.options.workspace.lstat) throw new Error("HOSTED_PLUGIN_LSTAT_UNAVAILABLE")
    return this.options.workspace.lstat(relPath)
  }

  private async statHostedDocument(rootRel: string, entry: string): Promise<Lstat> {
    const parts = entry.split("/").filter(Boolean)
    let current = rootRel
    let finalStat: Lstat | undefined
    for (let index = 0; index < parts.length; index += 1) {
      current = joinRel(current, parts[index]!)
      const stat = await this.lstat(current).catch(() => { throw new Error(`HOSTED_PLUGIN_DOCUMENT_NOT_FOUND: ${entry}`) })
      if (stat.kind === "symlink") throw new Error(`HOSTED_PLUGIN_DOCUMENT_SYMLINK: ${entry}`)
      if (index < parts.length - 1 && stat.kind !== "dir") throw new Error(`HOSTED_PLUGIN_DOCUMENT_NOT_FILE: ${entry}`)
      finalStat = stat
    }
    if (!finalStat) throw new Error(`HOSTED_PLUGIN_DOCUMENT_NOT_FOUND: ${entry}`)
    return finalStat
  }

  async load(): Promise<void> {
    const next = new Map<string, HostedRecord>()
    const errors = new Map<string, string>()
    const events: BoringPluginEvent[] = []
    let entries: Array<{ name: string; kind: "file" | "dir" }> = []
    try {
      entries = await this.options.workspace.readdir(".pi/extensions")
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.kind !== "dir") continue
      const rootRel = joinRel(".pi/extensions", entry.name)
      const manifestRel = joinRel(rootRel, "package.json")
      try {
        const stat = await this.lstat(manifestRel).catch(() => undefined)
        if (!stat || stat.kind === "symlink") {
          if (stat?.kind === "symlink") throw new Error("HOSTED_PLUGIN_MANIFEST_SYMLINK: package.json")
          continue
        }
        if (stat.kind !== "file") continue
        if (stat.size > BORING_PLUGIN_MANIFEST_MAX_BYTES) throw new Error(`HOSTED_PLUGIN_MANIFEST_TOO_LARGE: package.json must be at most ${BORING_PLUGIN_MANIFEST_MAX_BYTES} bytes`)
        const manifestText = await (this.options.workspace.readFileWithStat
          ? this.options.workspace.readFileWithStat(manifestRel).then((result) => result.content)
          : this.options.workspace.readFile(manifestRel)
        ).catch(() => { throw new Error("HOSTED_PLUGIN_MANIFEST_READ_FAILED: package.json") })
        if (byteLength(manifestText) > BORING_PLUGIN_MANIFEST_MAX_BYTES) throw new Error(`HOSTED_PLUGIN_MANIFEST_TOO_LARGE: package.json must be at most ${BORING_PLUGIN_MANIFEST_MAX_BYTES} bytes`)
        const rawPackageJson = JSON.parse(manifestText) as unknown
        if (!isRecord(rawPackageJson)) throw new Error("INVALID_FIELD package.json: package.json must be an object")
        const rawBoring = isRecord(rawPackageJson.boring) ? rawPackageJson.boring : undefined
        const hostedManifest: Record<string, unknown> = {}
        if ("name" in rawPackageJson) hostedManifest.name = rawPackageJson.name
        if ("version" in rawPackageJson) hostedManifest.version = rawPackageJson.version
        const hostedBoring: Record<string, unknown> = {}
        if (rawBoring && "id" in rawBoring) hostedBoring.id = rawBoring.id
        if (rawBoring && "label" in rawBoring) hostedBoring.label = rawBoring.label
        if (rawBoring && "iframePanels" in rawBoring) hostedBoring.iframePanels = rawBoring.iframePanels
        hostedManifest.boring = hostedBoring
        const validation = validateBoringPluginManifest(hostedManifest)
        if (!validation.valid) throw new Error(validation.issues.map((i) => `${i.code} ${i.field}: ${i.message}`).join("\n"))
        const packageJson = validation.packageJson
        const pluginId = hostedPluginIdFromPackageJson(packageJson, rootRel)
        if (!isValidBoringPluginId(pluginId)) throw new Error("INVALID_ID: hosted plugin id must be stable")
        const diagnostics: string[] = []
        if (rawBoring?.front !== undefined) diagnostics.push("boring.front ignored in hostedExternalPlugins mode")
        if (rawBoring?.server !== undefined) diagnostics.push("boring.server ignored in hostedExternalPlugins mode")
        if (rawPackageJson.pi !== undefined) diagnostics.push("pi contributions ignored in hostedExternalPlugins mode")
        const rawPanels = packageJson.boring?.iframePanels ?? []
        if (rawPanels.length === 0) {
          if (diagnostics.length > 0) errors.set(pluginId, diagnostics.join("\n"))
          continue
        }
        const panels: BoringIframePanelManifest[] = []
        const seenPanelIds = new Set<string>()
        for (const panel of rawPanels) {
          if (seenPanelIds.has(panel.id)) {
            diagnostics.push(`duplicate hosted iframe panel id ${panel.id}; ignoring later duplicate`)
            continue
          }
          seenPanelIds.add(panel.id)
          panels.push(panel)
        }
        if (panels.length === 0) continue
        if (next.has(pluginId)) diagnostics.push(`duplicate hosted plugin id ${pluginId}; ignoring later duplicate`)
        if (next.has(pluginId)) throw new Error(diagnostics.join("\n"))
        const revisionParts = [manifestText, String(stat.mtimeMs), String(stat.size)]
        for (const panel of panels) {
          const docRel = joinRel(rootRel, panel.entry)
          if (docRel.length > BORING_PLUGIN_IFRAME_DOCUMENT_PATH_MAX_LENGTH) throw new Error(`HOSTED_PLUGIN_DOCUMENT_PATH_TOO_LONG: ${panel.entry}`)
          const docStat = await this.statHostedDocument(rootRel, panel.entry)
          if (docStat.kind !== "file") throw new Error(`HOSTED_PLUGIN_DOCUMENT_NOT_FILE: ${panel.entry}`)
          if (docStat.size > BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES) throw new Error(`HOSTED_PLUGIN_DOCUMENT_TOO_LARGE: ${panel.entry}`)
          revisionParts.push(panel.id, panel.entry, String(docStat.mtimeMs), String(docStat.size))
        }
        const signature = hashSignature(...revisionParts)
        const previousRevision = this.revisionByPlugin.get(pluginId)
        const revision = previousRevision?.signature === signature
          ? previousRevision.revision
          : (previousRevision?.revision ?? 0) + 1
        this.revisionByPlugin.set(pluginId, { signature, revision })
        const record: HostedRecord = {
          id: pluginId,
          boring: {
            id: pluginId,
            ...(packageJson.boring?.label ? { label: packageJson.boring.label } : {}),
            iframePanels: panels,
          },
          version: packageJson.version ?? "0.0.0",
          revision,
          frontTarget: { kind: "iframe", trust: "hosted-untrusted-iframe", revision, panels },
          rootRel,
          signature,
          panelsById: new Map(panels.map((panel) => [panel.id, panel])),
        }
        next.set(pluginId, record)
        if (diagnostics.length > 0) errors.set(pluginId, diagnostics.join("\n"))
      } catch (err) {
        const id = entry.name
        const message = safeHostedErrorMessage(err instanceof Error ? err.message : String(err))
        errors.set(id, message)
        events.push(issue(id, message))
      }
    }
    const previous = this.records
    for (const [id, record] of previous) {
      if (!next.has(id)) {
        const previousRevision = this.revisionByPlugin.get(id)
        const revision = (previousRevision?.revision ?? record.revision) + 1
        this.revisionByPlugin.set(id, { signature: "__unloaded__", revision })
        events.push({ type: "boring.plugin.unload", id, revision })
      }
    }
    for (const [id, record] of next) {
      const old = previous.get(id)
      if (!old || old.revision !== record.revision) {
        events.push({
          type: "boring.plugin.load",
          id,
          boring: record.boring,
          version: record.version,
          revision: record.revision,
          ...(record.frontTarget ? { frontTarget: record.frontTarget } : {}),
        })
      }
    }
    this.records = next
    this.errors = errors
    this.loaded = true
    for (const event of events) this.emit(event)
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private emit(event: BoringPluginEvent): void {
    for (const listener of this.listeners) {
      try { listener(event) } catch { /* isolate subscriber failures from reload */ }
    }
  }

  async list(): Promise<BoringPluginListEntry[]> {
    await this.ensureLoaded()
    return [...this.records.values()].map(({ rootRel: _rootRel, signature: _signature, panelsById: _panelsById, ...entry }) => entry)
  }

  async listExternal(): Promise<BoringPluginListEntry[]> {
    return this.list()
  }

  getError(id: string): string | null {
    return this.errors.get(id) ?? null
  }

  getErrors(): Array<{ id: string; revision: number; message: string }> {
    return [...this.errors].map(([id, message]) => ({ id, revision: 0, message }))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async getIframeDocument(id: string, panelId: string, nonce: string): Promise<{ srcdoc: string; revision: number } | undefined> {
    await this.ensureLoaded()
    if (!nonce || nonce.length > 256) return undefined
    const record = this.records.get(id)
    const panel = record?.panelsById.get(panelId)
    if (!record || !panel) return undefined
    const docRel = joinRel(record.rootRel, panel.entry)
    if (docRel.length > BORING_PLUGIN_IFRAME_DOCUMENT_PATH_MAX_LENGTH) throw new Error("HOSTED_PLUGIN_DOCUMENT_PATH_TOO_LONG")
    const stat = await this.statHostedDocument(record.rootRel, panel.entry)
    if (stat.kind !== "file") throw new Error("HOSTED_PLUGIN_DOCUMENT_NOT_FILE")
    if (stat.size > BORING_PLUGIN_IFRAME_DOCUMENT_MAX_BYTES) throw new Error("HOSTED_PLUGIN_DOCUMENT_TOO_LARGE")
    const html = await (this.options.workspace.readFileWithStat
      ? this.options.workspace.readFileWithStat(docRel).then((result) => result.content)
      : this.options.workspace.readFile(docRel)
    ).catch(() => { throw new Error("HOSTED_PLUGIN_DOCUMENT_READ_FAILED") })
    return { srcdoc: createHostedIframeSrcdoc(html, nonce), revision: record.revision }
  }
}
