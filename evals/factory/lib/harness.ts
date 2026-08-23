/**
 * Shared boot/seed helpers for the factory eval suite (evals/factory/).
 *
 * Boots real production code paths — `createWorkspaceAgentServer` from
 * @hachej/boring-workspace/app/server, the real objectives/ask-user server
 * plugins, and the real @hachej/boring-agent/eval framework
 * (`evalAgentPrompt`) — against ephemeral temp-dir workspaces. No mocks.
 *
 * Live-model calls use LIVE_MODEL (see below — requested stealth/ox-alpha,
 * substituted for a catalog reason documented there) and are gated by
 * FACTORY_EVALS_LIVE=1 at the call site, not here.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { FastifyInstance } from "fastify"
import { createWorkspaceAgentServer } from "@hachej/boring-workspace/app/server"
import {
  createObjectivesServerPlugin,
  FileObjectiveStore,
  type ObjectiveStore,
} from "@hachej/boring-objectives/server"
import {
  createAskUserServerPlugin,
  FileAskUserStore,
  AskUserRuntime,
} from "@hachej/boring-ask-user/server"

/**
 * Requested model policy was provider "openrouter", model "stealth/ox-alpha"
 * (free, no credentials cost). Verified live against OpenRouter's own
 * /api/v1/models (pricing.prompt === "0") that stealth/ox-alpha IS
 * genuinely free and IS being served right now. The blocker is local: this
 * repo's pinned model catalog (@mariozechner/pi-coding-agent's built-in
 * ModelRegistry, generated from an older OpenRouter snapshot) does not
 * contain "stealth/ox-alpha", and createHarness.ts's strict model
 * resolution (packages/agent/src/server/harness/pi-coding-agent/
 * createHarness.ts resolveRequestedModel / modelUnavailableError) rejects
 * any id the registry doesn't recognize with a 400 before a turn ever
 * starts — confirmed by direct debugging (evals/factory/_debug.ts, not
 * committed), which showed a byte-identical failure across three different
 * requested model ids, tracing to ModelRegistry.find() returning
 * `undefined` for all of them because none were in the generated catalog.
 * Registering a custom model into that registry is possible in principle
 * (ModelRegistry.registerProvider / a models.json on
 * ModelRegistry.create(authStorage, modelsJsonPath)) but reaches into
 * createHarness.ts's internals, which createWorkspaceAgentServer does not
 * expose to callers — doing it properly is a harness change, not an eval
 * change, so it's left as a follow-up rather than half-built here.
 *
 * Substituted default: "openrouter/free" — OpenRouter's own free
 * auto-router (confirmed both plain-text and tool-calling via curl against
 * the real API; it round-robins real free backends, e.g. Nvidia Nemotron
 * models) IS present in this repo's static catalog and needs no registry
 * change. Override via FACTORY_EVALS_LIVE_MODEL_PROVIDER /
 * FACTORY_EVALS_LIVE_MODEL_ID — set those to openrouter / stealth/ox-alpha
 * to retry the originally requested model once it (or an equivalent)
 * appears in the catalog, or after a harness change exposes registerProvider.
 */
export const LIVE_MODEL = {
  provider: process.env.FACTORY_EVALS_LIVE_MODEL_PROVIDER ?? "openrouter",
  id: process.env.FACTORY_EVALS_LIVE_MODEL_ID ?? "openrouter/free",
} as const

export const LIVE_ENABLED = process.env.FACTORY_EVALS_LIVE === "1"

/** Default per-call timeout for the free/stealth live model — generous, it can be slow. */
export const LIVE_TIMEOUT_MS = Number(process.env.FACTORY_EVALS_LIVE_TIMEOUT_MS ?? 60_000)

export function makeTempWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `factory-eval-${prefix}-`))
}

export function cleanupWorkspace(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

export interface ObjectivesAskUserHost {
  app: FastifyInstance
  workspaceRoot: string
  objectiveStore: ObjectiveStore
  askUserRuntime: AskUserRuntime
  askUserStore: FileAskUserStore
  close(): Promise<void>
}

/**
 * Boots a real `createWorkspaceAgentServer` app (mode: "direct", no
 * sandbox) with the real objectives + ask-user server plugins wired in —
 * the exact shape the objectives-plugin branch composes for a live
 * workspace, minus the front end. Returns handles to the underlying stores
 * so evals can seed/poll/answer without going through the model.
 */
export async function bootObjectivesAskUserHost(
  workspacePrefixOrRoot: string = "objectives-ask-user",
  opts: { reuseWorkspaceRoot?: boolean } = {},
): Promise<ObjectivesAskUserHost> {
  const workspaceRoot = opts.reuseWorkspaceRoot ? workspacePrefixOrRoot : makeTempWorkspace(workspacePrefixOrRoot)

  const objectiveStore = new FileObjectiveStore(join(workspaceRoot, ".boring", "objectives.json"), {
    workspaceRoot,
  })
  // Prebuilt (non-dir-source) plugin objects that contribute agentTools/
  // workspaceBridgeHandlers must carry a contentDigest — createWorkspaceAgentServer
  // uses it for hot-reload identity tracking, which this eval harness doesn't
  // need. A static per-plugin string satisfies the invariant honestly (it's
  // not lying about directory contents; it's declaring "no reload identity
  // tracked here", which is true for an eval-only boot).
  const objectivesPlugin = {
    ...createObjectivesServerPlugin({ workspaceRoot, store: objectiveStore }),
    contentDigest: "factory-eval:objectives-plugin",
  }

  const askUserStore = new FileAskUserStore(join(workspaceRoot, ".boring", "ask-user.json"))
  const askUserRuntime = new AskUserRuntime({ store: askUserStore })
  const askUserPlugin = {
    ...createAskUserServerPlugin({ workspaceRoot, runtime: askUserRuntime }),
    contentDigest: "factory-eval:ask-user-plugin",
  }

  const app = await createWorkspaceAgentServer({
    workspaceRoot,
    mode: "direct",
    logger: false,
    plugins: [objectivesPlugin, askUserPlugin],
  })

  return {
    app,
    workspaceRoot,
    objectiveStore,
    askUserRuntime,
    askUserStore,
    async close() {
      await app.close()
      if (!opts.reuseWorkspaceRoot) cleanupWorkspace(workspaceRoot)
    },
  }
}

/**
 * `bootObjectivesAskUserHost.close()` always deletes its temp workspace
 * unless `reuseWorkspaceRoot` was set — for a simulated-restart eval that
 * boots a second host on the SAME root, call this after the LAST host
 * closes.
 */
export function cleanupSharedWorkspace(root: string): void {
  cleanupWorkspace(root)
}

/** Poll until `predicate()` resolves truthy or `timeoutMs` elapses. Returns the truthy value or undefined on timeout. */
export async function pollUntil<T>(
  predicate: () => Promise<T | undefined | null | false>,
  { timeoutMs = 20_000, intervalMs = 200 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export function timed<T>(fn: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const start = Date.now()
  return fn().then((value) => ({ value, durationMs: Date.now() - start }))
}
