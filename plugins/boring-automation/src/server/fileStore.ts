import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  Automation,
  AutomationCreate,
  AutomationPatch,
  AutomationRun,
  AutomationRunCreate,
  AutomationRunPatch,
} from "../shared/types"
import type { AutomationStore } from "./store"
import { automationNotFound, runNotFound } from "./store"

type StoredAutomationState = {
  automations: Record<string, Automation>
  runs: Record<string, AutomationRun>
}

type AtomicWriter = (path: string, content: string) => Promise<void>

export interface FileAutomationStoreOptions {
  writer?: AtomicWriter
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
  private readonly writer: AtomicWriter

  constructor(
    private readonly rootDir: string,
    options: FileAutomationStoreOptions = {},
  ) {
    this.writer = options.writer ?? writeAtomic
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
    const now = nowIso()
    const id = randomUUID()
    const automation: Automation = {
      id,
      title: input.title,
      enabled: input.enabled ?? true,
      cron: input.cron,
      timezone: input.timezone,
      model: input.model,
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
        updatedAt: nowIso(),
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
      current.updatedAt = nowIso()
    })
  }

  async createRun(input: AutomationRunCreate): Promise<AutomationRun> {
    const now = nowIso()
    let run: AutomationRun | undefined
    await this.mutate((state) => {
      if (!state.automations[input.automationId]) throw automationNotFound(input.automationId)
      run = {
        id: randomUUID(),
        automationId: input.automationId,
        sessionId: input.sessionId ?? null,
        status: input.status ?? "queued",
        trigger: input.trigger,
        scheduledFor: input.scheduledFor ?? null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        durationMs: input.durationMs ?? null,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        promptSnapshot: input.promptSnapshot,
        modelSnapshot: input.modelSnapshot,
        error: input.error ?? null,
        createdAt: now,
        updatedAt: now,
      }
      state.runs[run.id] = clone(run)
    })
    return clone(requireValue(run))
  }

  async updateRun(runId: string, patch: AutomationRunPatch): Promise<AutomationRun> {
    let updated: AutomationRun | undefined
    await this.mutate((state) => {
      const run = state.runs[runId]
      if (!run) throw runNotFound(runId)
      updated = applyRunPatch(run, patch)
      state.runs[runId] = updated
    })
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

  async findRunningRun(automationId: string): Promise<AutomationRun | null> {
    const runs = await this.listRuns(automationId)
    return runs.find((run) => run.status === "running") ?? null
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

function applyRunPatch(run: AutomationRun, patch: AutomationRunPatch): AutomationRun {
  const next: AutomationRun = { ...run, updatedAt: nowIso() }
  for (const [key, value] of Object.entries(patch) as Array<[keyof AutomationRunPatch, AutomationRunPatch[keyof AutomationRunPatch]]>) {
    if (value !== undefined) (next as Record<keyof AutomationRunPatch, unknown>)[key] = value
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

function nowIso(): string {
  return new Date().toISOString()
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected automation store mutation to produce a value")
  return value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
