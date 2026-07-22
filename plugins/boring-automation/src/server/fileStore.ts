import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunBegin,
  AutomationRunLifecyclePatch,
} from "../shared/types"
import type { AutomationStore } from "./store"
import { automationNotFound, runAlreadyActive, runAlreadyRecorded, runNotFound } from "./store"

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
  private state: StoredAutomationState | null = null
  private loadInFlight: Promise<StoredAutomationState> | null = null
  private writeChain = Promise.resolve()
  /** Active runs owned by this store process; persisted active runs are orphaned after restart. */
  private readonly activeRunIds = new Set<string>()
  private readonly writer: AtomicWriter
  private readonly clock: () => Date

  constructor(
    private readonly rootDir: string,
    options: FileAutomationStoreOptions = {},
  ) {
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
    const state = await this.load()
    const automation = state.automations[id]
    return automation ? clone(automation) : null
  }

  async createAutomation(input: AutomationCreate): Promise<Automation> {
    const now = this.nowIso()
    const id = randomUUID()
    const automation: Automation = {
      id,
      title: input.title,
      enabled: input.enabled ?? true,
      cron: input.cron,
      timezone: input.timezone,
      model: input.model,
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      promptRef: promptRefForId(id),
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
      return await readFile(this.promptPath(automationId), "utf8")
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
    await this.writePromptFile(automationId, body)
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
    let run: AutomationRun | undefined
    await this.mutate((state) => {
      if (!state.automations[input.automationId]) throw automationNotFound(input.automationId)
      reconcileOrphanedRuns(state, input.automationId, this.activeRunIds, now)
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
        && (candidate.status === "queued" || candidate.status === "running")
      ))
      if (active) throw runAlreadyActive(input.automationId)
      run = {
        id: randomUUID(),
        automationId: input.automationId,
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

  async updateRunLifecycle(runId: string, patch: AutomationRunLifecyclePatch): Promise<AutomationRun> {
    let updated: AutomationRun | undefined
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) throw runNotFound(runId)
      updated = applyRunPatch(run, patch, this.nowIso())
      state.runs[runId] = updated
    })
    if (updated && isTerminalRunStatus(updated.status)) this.activeRunIds.delete(runId)
    return clone(requireValue(updated))
  }

  async listRuns(automationId: string): Promise<AutomationRun[]> {
    const automation = await this.getAutomation(automationId)
    if (!automation) throw automationNotFound(automationId)
    const state = await this.load()
    return Object.values(state.runs)
      .filter((run) => run.automationId === automationId)
      .sort((a, b) => runSortTimestamp(b).localeCompare(runSortTimestamp(a)))
      .map(clone)
  }

  private statePath(): string {
    return join(this.rootDir, "store.json")
  }

  private promptPath(automationId: string): string {
    if (!SAFE_PROMPT_ID.test(automationId)) throw automationNotFound(automationId)
    return join(this.rootDir, "prompts", `${automationId}.md`)
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
            automations: parsed.automations && typeof parsed.automations === "object" ? parsed.automations : {},
            runs: parsed.runs && typeof parsed.runs === "object" ? parsed.runs : {},
          }
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

function promptRefForId(id: string): string {
  return `prompts/${id}.md`
}

function reconcileOrphanedRuns(
  state: StoredAutomationState,
  automationId: string,
  activeRunIds: ReadonlySet<string>,
  completedAt: string,
): void {
  for (const run of Object.values(state.runs)) {
    if (run.automationId !== automationId || isTerminalRunStatus(run.status) || activeRunIds.has(run.id)) continue
    run.status = "failed"
    run.completedAt = completedAt
    run.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(run.startedAt ?? run.createdAt).getTime())
    run.error = "Automation host restarted before the run completed"
    run.updatedAt = completedAt
  }
}

function isTerminalRunStatus(status: AutomationRun["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled"
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
