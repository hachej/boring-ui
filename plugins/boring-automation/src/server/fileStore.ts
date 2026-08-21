import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, normalize, relative } from "node:path"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunBegin,
  AutomationRunLifecyclePatch,
} from "../shared/types"
import { automationPromptPath } from "../shared/prompt"
import { clampAutomationPersistedDurationMs, MAX_AUTOMATION_DURATION_MS } from "../shared/schedule"
import { isAutomationRunOccupying, reconcileAbandonedRun } from "../shared/runStatus"
import type { AutomationSeed, AutomationStore } from "./store"
import { automationNotFound, runAlreadyActive, runAlreadyRecorded, runLeaseLost, runNotFound } from "./store"

type StoredAutomationState = {
  automations: Record<string, Automation>
  runs: Record<string, AutomationRun>
}

type AtomicWriter = (path: string, content: string) => Promise<void>

export interface FileAutomationStoreOptions {
  writer?: AtomicWriter
  clock?: () => Date
}

const EMPTY_STATE: StoredAutomationState = {
  automations: {},
  runs: {},
}

const SAFE_PROMPT_ID = /^[a-zA-Z0-9_-]+$/
const DEFAULT_PROMPT = ""

export class FileAutomationStore implements AutomationStore {
  private readonly workspaceRoot: string
  private readonly rootDir: string
  private state: StoredAutomationState | null = null
  private loadInFlight: Promise<StoredAutomationState> | null = null
  private writeChain = Promise.resolve()
  /** Active runs owned by this store process; persisted active runs are orphaned after restart. */
  private readonly activeRunIds = new Set<string>()
  private readonly writer: AtomicWriter
  private readonly clock: () => Date
  private readonly promptDir: string

  constructor(
    workspaceRoot: string,
    options: FileAutomationStoreOptions = {},
  ) {
    this.workspaceRoot = workspaceRoot
    this.rootDir = join(workspaceRoot, ".pi", "automation")
    this.promptDir = join(workspaceRoot, ".agents", "automation")
    this.writer = options.writer ?? writeAtomic
    this.clock = options.clock ?? (() => new Date())
  }

  async listAutomations(): Promise<Automation[]> {
    const state = await this.load()
    return Object.values(state.automations)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone)
  }

  async getAutomation(id: string): Promise<Automation | null> {
    const automation = (await this.load()).automations[id]
    return automation ? clone(automation) : null
  }

  async createAutomation(input: AutomationCreate): Promise<Automation> {
    const now = this.nowIso()
    const id = randomUUID()
    const automation: Automation = {
      id,
      title: input.title,
      enabled: input.enabled ?? true,
      cron: input.cron ?? null,
      timezone: input.timezone,
      model: input.model,
      ...(input.agentTypeId ? { agentTypeId: input.agentTypeId } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      ...(input.runDurationCapMs === undefined ? {} : { runDurationCapMs: input.runDurationCapMs }),
      promptRef: automationPromptPath(id),
      createdAt: now,
      updatedAt: now,
    }

    // The prompt is canonical and store.json is the commit point, so metadata is written last.
    await this.writePromptFile(automation.id, input.prompt ?? DEFAULT_PROMPT)
    await this.mutate((state) => {
      state.automations[automation.id] = clone(automation)
    })

    return clone(automation)
  }

  async readSeedManifest(): Promise<string | null> {
    try {
      return await readFile(join(this.workspaceRoot, ".agents", "automation", "manifest.json"), "utf8")
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async ensureSeededAutomation(input: AutomationSeed): Promise<Automation | null> {
    try {
      await readFile(this.workspacePath(input.promptRef), "utf8")
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null
      throw error
    }

    let seeded: Automation | undefined
    await this.mutate((state) => {
      const existing = state.automations[input.key]
      if (existing) {
        seeded = existing
        return
      }
      const now = this.nowIso()
      seeded = {
        id: input.key,
        title: input.title,
        enabled: input.enabled,
        cron: input.cron,
        timezone: input.timezone,
        model: input.model,
        agentTypeId: input.agentTypeId,
        ...(input.runDurationCapMs === undefined ? {} : { runDurationCapMs: input.runDurationCapMs }),
        promptRef: input.promptRef,
        createdAt: now,
        updatedAt: now,
      }
      state.automations[input.key] = clone(seeded)
    })
    return clone(requireValue(seeded))
  }

  async findExistingSeedKeys(keys: readonly string[]): Promise<readonly string[]> {
    const state = await this.load()
    return keys.filter((key) => state.automations[key]?.id === key)
  }

  async removeSeededAutomationIfIdle(key: string): Promise<boolean> {
    let removed = false
    await this.mutate((state) => {
      const automation = state.automations[key]
      if (!automation || automation.id !== key) return
      const occupied = Object.values(state.runs).some((run) => (
        run.automationId === key && isAutomationRunOccupying(run.status)
      ))
      if (occupied) return
      delete state.automations[key]
      removed = true
    })
    return removed
  }

  async updateAutomation(id: string, patch: AutomationPatch): Promise<Automation> {
    let updated: Automation | undefined
    await this.mutate((state) => {
      const automation = state.automations[id]
      if (!automation) throw automationNotFound(id)
      updated = {
        ...automation,
        ...patch,
        id: automation.id,
        promptRef: automation.promptRef,
        createdAt: automation.createdAt,
        updatedAt: this.nowIso(),
      }
      state.automations[id] = updated
    })
    return clone(requireValue(updated))
  }

  async deleteAutomation(id: string): Promise<void> {
    await this.mutate((state) => {
      if (!state.automations[id]) throw automationNotFound(id)
      delete state.automations[id]
      // Intentionally leave the prompt markdown file and run records on disk.
      // This operation removes metadata only; it does not delete user-editable files.
    })
  }

  async getPrompt(automationId: string): Promise<string> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    try {
      return await readFile(this.workspacePath(automation.promptRef), "utf8")
    } catch (error) {
      // Existing automation + missing markdown file is treated as an empty prompt.
      // Saving the prompt recreates the canonical file.
      if ((error as { code?: string }).code === "ENOENT") return DEFAULT_PROMPT
      throw error
    }
  }

  async updatePrompt(automationId: string, body: string): Promise<void> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    await this.writer(this.workspacePath(automation.promptRef), body)
    await this.mutate((state) => {
      const current = state.automations[automationId]
      if (!current) throw automationNotFound(automationId)
      current.updatedAt = this.nowIso()
    })
  }

  async reconcileOrphanedRuns(automationId: string): Promise<void> {
    const now = this.nowIso()
    await this.mutate((state) => {
      if (!state.automations[automationId]) throw automationNotFound(automationId)
      reconcileOrphanedRuns(state, automationId, this.activeRunIds, now)
    })
  }

  async beginRun(input: AutomationRunBegin): Promise<AutomationRun> {
    const now = input.createdAt ?? this.nowIso()
    await this.reconcileOrphanedRuns(input.automationId)
    let run: AutomationRun | undefined
    await this.mutate((state) => {
      if (!state.automations[input.automationId]) throw automationNotFound(input.automationId)
      const existingInvocation = input.invocationId
        ? Object.values(state.runs).find((candidate) => candidate.automationId === input.automationId && candidate.invocationId === input.invocationId)
        : undefined
      if (existingInvocation) {
        run = clone(existingInvocation)
        return
      }
      if (input.trigger === "scheduled" && input.scheduledFor) {
        const duplicate = Object.values(state.runs).some((candidate) => (
          candidate.automationId === input.automationId
          && candidate.trigger === "scheduled"
          && candidate.scheduledFor === input.scheduledFor
        ))
        if (duplicate) throw runAlreadyRecorded(input.automationId, input.scheduledFor)
      }
      const active = Object.values(state.runs).find((candidate) => (
        candidate.automationId === input.automationId
        && isAutomationRunOccupying(candidate.status)
      ))
      if (active) throw runAlreadyActive(input.automationId)
      const id = randomUUID()
      run = {
        id,
        automationId: input.automationId,
        invocationId: input.invocationId ?? `store:${randomUUID()}`,
        dispatchRequestId: id,
        dispatchReceipt: null,
        sessionId: null,
        status: "queued",
        trigger: input.trigger,
        scheduledFor: input.scheduledFor ?? null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        promptSnapshot: input.promptSnapshot,
        modelSnapshot: input.modelSnapshot,
        error: null,
        createdAt: now,
        updatedAt: now,
      }
      state.runs[run.id] = clone(run)
      this.activeRunIds.add(run.id)
    })
    return clone(requireValue(run))
  }

  async claimRunForDispatch(runId: string): Promise<AutomationRun | null> {
    let claimed: AutomationRun | undefined
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) throw runNotFound(runId)
      if (run.status !== "queued") return
      claimed = applyRunPatch(run, { status: "dispatching" }, this.nowIso())
      state.runs[runId] = claimed
    })
    return claimed ? clone(claimed) : null
  }

  async heartbeatRun(runId: string): Promise<boolean> {
    let renewed = false
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) throw runNotFound(runId)
      if (run.status === "queued" || run.status === "dispatching" || run.status === "running") {
        state.runs[runId] = { ...run, updatedAt: this.nowIso() }
        renewed = true
      }
    })
    return renewed
  }

  async preserveAcceptedDispatch(
    runId: string,
    receipt: NonNullable<AutomationRun["dispatchReceipt"]>,
    completedAt: string,
    error: string,
  ): Promise<AutomationRun | null> {
    let preserved: AutomationRun | undefined
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) return
      if (run.dispatchReceipt) {
        preserved = run
        return
      }
      preserved = applyRunPatch(run, {
        status: "outcome-unknown",
        sessionId: receipt.ref.sessionId,
        dispatchReceipt: receipt,
        completedAt,
        error,
      }, this.nowIso())
      state.runs[runId] = preserved
    })
    if (preserved) this.activeRunIds.add(runId)
    return preserved ? clone(preserved) : null
  }

  async updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun> {
    let updated: AutomationRun | undefined
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) throw runNotFound(runId)
      if (run.status !== "queued" && run.status !== "dispatching" && run.status !== "running") throw runLeaseLost(runId)
      updated = applyRunPatch(run, patch, this.nowIso())
      state.runs[runId] = updated
    })
    if (updated && !isAutomationRunOccupying(updated.status)) this.activeRunIds.delete(runId)
    return clone(requireValue(updated))
  }

  async getRun(automationId: string, runId: string): Promise<AutomationRun | null> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    const run = (await this.load()).runs[runId]
    return run?.automationId === automationId ? clone(run) : null
  }

  async listRuns(automationId: string, limit?: number): Promise<AutomationRun[]> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    const state = await this.load()
    const runs = Object.values(state.runs)
      .filter((run) => run.automationId === automationId)
      .sort((a, b) => runSortTimestamp(b).localeCompare(runSortTimestamp(a)))
    return runs.slice(0, limit ?? runs.length).map(clone)
  }

  async listRecentRuns(limit: number): Promise<AutomationRun[]> {
    const state = await this.load()
    return Object.values(state.runs)
      .filter((run) => state.automations[run.automationId] !== undefined)
      .sort((a, b) => runSortTimestamp(b).localeCompare(runSortTimestamp(a)))
      .slice(0, limit)
      .map(clone)
  }

  async findRunBySessionRef(ref: { agentTypeId: string; sessionId: string }): Promise<AutomationRun | null> {
    const state = await this.load()
    const run = Object.values(state.runs)
      .filter((candidate) => (
        candidate.dispatchReceipt?.ref.agentTypeId === ref.agentTypeId
        && candidate.dispatchReceipt.ref.sessionId === ref.sessionId
        && state.automations[candidate.automationId] !== undefined
      ))
      .sort((a, b) => runSortTimestamp(b).localeCompare(runSortTimestamp(a)))[0]
    return run ? clone(run) : null
  }

  private statePath(): string {
    return join(this.rootDir, "store.json")
  }

  private promptPath(automationId: string): string {
    if (!SAFE_PROMPT_ID.test(automationId)) throw automationNotFound(automationId)
    return join(this.promptDir, `${automationId}.md`)
  }

  private workspacePath(promptRef: string): string {
    const normalized = normalize(promptRef)
    const rel = relative(".", normalized)
    if (rel.startsWith("..") || !rel.startsWith(`${normalize(".agents/automation")}/`)) {
      throw new Error("automation prompt reference must stay within .agents/automation")
    }
    return join(this.workspaceRoot, rel)
  }

  private async writePromptFile(automationId: string, body: string): Promise<void> {
    await this.writer(this.promptPath(automationId), body)
  }

  private async mutate(fn: (state: StoredAutomationState) => Promise<void> | void): Promise<void> {
    const run = this.writeChain.then(async () => {
      const state = clone(await this.load())
      await fn(state)
      await this.writer(this.statePath(), `${JSON.stringify(state, null, 2)}\n`)
      this.state = state
    })
    this.writeChain = run.catch(() => undefined)
    return run
  }

  private nowIso(): string {
    return this.clock().toISOString()
  }

  private async load(): Promise<StoredAutomationState> {
    if (this.state) return this.state
    if (!this.loadInFlight) {
      this.loadInFlight = (async () => {
        try {
          const raw = await readFile(this.statePath(), "utf8")
          const parsed = JSON.parse(raw) as Partial<StoredAutomationState>
          this.state = {
            automations: parsed.automations && typeof parsed.automations === "object"
              ? parsed.automations as Record<string, Automation>
              : {},
            runs: parsed.runs && typeof parsed.runs === "object"
              ? Object.fromEntries(Object.entries(parsed.runs).map(([id, value]) => {
                  const run = value as AutomationRun
                  return [id, {
                    ...run,
                    invocationId: run.invocationId ?? `legacy:${id}`,
                    dispatchRequestId: run.dispatchRequestId ?? id,
                    dispatchReceipt: run.dispatchReceipt ?? null,
                  }]
                }))
              : {},
          }
          for (const automation of Object.values(this.state.automations)) assertPersistedDurationCap(automation)
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error
          this.state = clone(EMPTY_STATE)
        }
        return this.state
      })().finally(() => {
        this.loadInFlight = null
      })
    }
    return this.loadInFlight
  }
}

function reconcileOrphanedRuns(
  state: StoredAutomationState,
  automationId: string,
  activeRunIds: ReadonlySet<string>,
  completedAt: string,
): void {
  for (const run of Object.values(state.runs)) {
    if (run.automationId !== automationId || !isAutomationRunOccupying(run.status) || activeRunIds.has(run.id)) continue
    if (run.status === "outcome-unknown" && run.dispatchReceipt) continue
    const reconciled = reconcileAbandonedRun(run.status, "host-restart")
    run.status = reconciled.status
    run.completedAt = completedAt
    run.durationMs = clampAutomationPersistedDurationMs(new Date(completedAt).getTime() - new Date(run.startedAt ?? run.createdAt).getTime())
    run.error = reconciled.error
    run.updatedAt = completedAt
  }
}

function assertPersistedDurationCap(automation: Automation): void {
  const cap = automation.runDurationCapMs
  if (cap == null) return
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > MAX_AUTOMATION_DURATION_MS) {
    throw new Error(`automation ${automation.id} has an invalid persisted run duration cap`)
  }
}

function applyRunPatch(run: AutomationRun, patch: AutomationRunLifecyclePatch, updatedAt: string): AutomationRun {
  const next: AutomationRun = { ...run, updatedAt }
  for (const [key, value] of Object.entries(patch) as Array<[keyof AutomationRunLifecyclePatch, AutomationRunLifecyclePatch[keyof AutomationRunLifecyclePatch]]>) {
    if (value !== undefined) (next as Record<keyof AutomationRunLifecyclePatch, unknown>)[key] = value
  }
  return next
}

function runSortTimestamp(run: AutomationRun): string {
  return run.startedAt ?? run.scheduledFor ?? run.createdAt
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  await writeFile(tmp, content, "utf8")
  await rename(tmp, path)
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected automation store mutation to produce a value")
  return value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
