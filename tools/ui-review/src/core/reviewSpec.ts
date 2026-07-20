import { isAbsolute } from "node:path"
import type { Page } from "@playwright/test"
import { UI_REVIEW_MAX_STATES_PER_VIEWPORT, type UiHardGateReport, type UiReviewManifest, type UiReviewState, type UiReviewViewport } from "./contracts"

export type UiReviewBrowserErrors = {
  consoleErrors: string[]
  pageErrors: string[]
  requestFailures: Array<{ url: string; errorText: string }>
  httpErrors: Array<{ url: string; status: number }>
}

export type UiReviewTargetRoot = `apps/${string}` | `tools/ui-review/fixtures/${string}`

export type UiReviewTarget = {
  root: UiReviewTargetRoot
  buildCommand: readonly [string, ...string[]]
  serverCommand: readonly [string, ...string[]]
  route: string
  fixturePath?: string
  defaultPort: number
  defaultApiPort?: number
  serverEnvironmentKeys: readonly string[]
  environment(input: { isolation: Record<"home" | "config" | "cache" | "workspace" | "sessions", string>; port: number; apiPort?: number }): Record<string, string>
  ready(page: Page, timeoutMs: number): Promise<void>
}

export type UiReviewExplorationState = UiReviewState & {
  ordinal: number
  normalizedState: Record<string, unknown>
}

export type UiReviewVisualBaseline = {
  fileName: string
  locator: string
  maxDiffPixels: number
  rationale: string
}

export type UiReviewVisualBaselineResult = {
  passed: boolean
  evidence: string
}

export type UiReviewCheckpoint = {
  id: string
  viewportNames?: readonly string[]
  colorScheme?: "light" | "dark"
  visualBaseline?: UiReviewVisualBaseline
  reach(page: Page): Promise<void>
}

export type UiReviewSpec = {
  id: string
  specRevision: string
  fixtureResetId: string
  rubricVersion: string
  target: UiReviewTarget
  viewports: readonly UiReviewViewport[]
  checkpoints: readonly UiReviewCheckpoint[]
  criticPrompt: string
  criticContextPaths: readonly string[]
  ownerSpotChecks: readonly string[]
  hardGates: {
    contractVersion: string
    collect(
      page: Page,
      stateId: string,
      checkpoint: string,
      viewport: UiReviewViewport,
      errors: UiReviewBrowserErrors,
      visualBaseline?: UiReviewVisualBaselineResult,
    ): Promise<unknown>
    evaluate(snapshot: unknown): UiHardGateReport
    validate(report: UiHardGateReport, manifest: UiReviewManifest): void
  }
  exploration?: {
    bombadilSpecPath: string
    ready?(page: Page, timeoutMs: number): Promise<void>
    selectReplayState(states: readonly UiReviewExplorationState[]): UiReviewExplorationState | undefined
  }
}

export function validateUiReviewSpec(spec: UiReviewSpec): UiReviewSpec {
  if (!isSlug(spec.id)) throw new Error(`UI_REVIEW_SPEC_ID_INVALID:${spec.id}`)
  if (!spec.specRevision.trim() || !spec.fixtureResetId.trim() || !spec.rubricVersion.trim()) throw new Error(`UI_REVIEW_SPEC_METADATA_INVALID:${spec.id}`)
  if (!/^(?:apps\/[a-z0-9][a-z0-9-]*|tools\/ui-review\/fixtures\/[a-z0-9][a-z0-9-]*)$/.test(spec.target.root)) {
    throw new Error(`UI_REVIEW_SPEC_TARGET_ROOT_INVALID:${spec.id}`)
  }
  if (!spec.target.route.startsWith("/") || spec.target.route.startsWith("//") || spec.target.route.includes("\\")) throw new Error(`UI_REVIEW_SPEC_ROUTE_INVALID:${spec.id}`)
  if (!Number.isInteger(spec.target.defaultPort) || spec.target.defaultPort < 1024 || spec.target.defaultPort > 65_535) throw new Error(`UI_REVIEW_SPEC_PORT_INVALID:${spec.id}`)
  if (spec.target.defaultApiPort !== undefined && (!Number.isInteger(spec.target.defaultApiPort) || spec.target.defaultApiPort < 1024 || spec.target.defaultApiPort > 65_535)) throw new Error(`UI_REVIEW_SPEC_PORT_INVALID:${spec.id}`)
  if (spec.target.fixturePath !== undefined && !isRepoPath(spec.target.fixturePath)) throw new Error(`UI_REVIEW_SPEC_FIXTURE_INVALID:${spec.id}`)
  if (spec.target.serverEnvironmentKeys.length === 0
    || new Set(spec.target.serverEnvironmentKeys).size !== spec.target.serverEnvironmentKeys.length
    || spec.target.serverEnvironmentKeys.some((key) => !/^[A-Z][A-Z0-9_]*$/.test(key) || isReservedEnvironmentKey(key))) throw new Error(`UI_REVIEW_SPEC_ENV_INVALID:${spec.id}`)
  if (spec.viewports.length === 0
    || spec.viewports.length > 8
    || new Set(spec.viewports.map((viewport) => viewport.name)).size !== spec.viewports.length
    || spec.viewports.some((viewport) => !isValidViewport(viewport))) {
    throw new Error(`UI_REVIEW_SPEC_VIEWPORTS_INVALID:${spec.id}`)
  }
  const viewportNames = new Set(spec.viewports.map((viewport) => viewport.name))
  const maxCheckpointsPerViewport = UI_REVIEW_MAX_STATES_PER_VIEWPORT / 2
  if (spec.checkpoints.length === 0
    || new Set(spec.checkpoints.map((checkpoint) => checkpoint.id)).size !== spec.checkpoints.length
    || spec.checkpoints.some((checkpoint) => !isValidCheckpoint(checkpoint, viewportNames))
    || spec.viewports.some((viewport) => (
      spec.checkpoints.filter((checkpoint) => checkpointAppliesToViewport(checkpoint, viewport.name)).length
      > maxCheckpointsPerViewport
    ))) {
    throw new Error(`UI_REVIEW_SPEC_CHECKPOINTS_INVALID:${spec.id}`)
  }
  if (!spec.criticPrompt.trim() || spec.criticContextPaths.length === 0 || spec.criticContextPaths.some((path) => !isRepoPath(path))) throw new Error(`UI_REVIEW_SPEC_CRITIC_INVALID:${spec.id}`)
  if (spec.ownerSpotChecks.length === 0 || spec.ownerSpotChecks.some((step) => !step.trim())) throw new Error(`UI_REVIEW_SPEC_HANDOFF_INVALID:${spec.id}`)
  if (!spec.hardGates.contractVersion.trim()) throw new Error(`UI_REVIEW_SPEC_HARD_GATES_INVALID:${spec.id}`)
  if (spec.exploration && (!isAbsolute(spec.exploration.bombadilSpecPath) || typeof spec.exploration.selectReplayState !== "function")) throw new Error(`UI_REVIEW_SPEC_EXPLORATION_INVALID:${spec.id}`)
  return spec
}

export function checkpointAppliesToViewport(checkpoint: UiReviewCheckpoint, viewportName: string): boolean {
  return checkpoint.viewportNames === undefined || checkpoint.viewportNames.includes(viewportName)
}

function isValidViewport(viewport: UiReviewViewport): boolean {
  return isSlug(viewport.name)
    && Number.isInteger(viewport.width) && viewport.width >= 1 && viewport.width <= 8_192
    && Number.isInteger(viewport.height) && viewport.height >= 1 && viewport.height <= 8_192
    && Number.isFinite(viewport.deviceScaleFactor) && viewport.deviceScaleFactor > 0 && viewport.deviceScaleFactor <= 4
}

function isValidCheckpoint(checkpoint: UiReviewCheckpoint, viewportNames: ReadonlySet<string>): boolean {
  const selectedViewports = checkpoint.viewportNames
  return isSlug(checkpoint.id)
    && (checkpoint.colorScheme === undefined || checkpoint.colorScheme === "light" || checkpoint.colorScheme === "dark")
    && (selectedViewports === undefined || (
      selectedViewports.length > 0
      && new Set(selectedViewports).size === selectedViewports.length
      && selectedViewports.every((name) => viewportNames.has(name))
    ))
    && (checkpoint.visualBaseline === undefined || isValidVisualBaseline(checkpoint.visualBaseline))
}

function isValidVisualBaseline(baseline: UiReviewVisualBaseline): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(baseline.fileName)
    && Boolean(baseline.locator.trim())
    && Boolean(baseline.rationale.trim())
    && Number.isInteger(baseline.maxDiffPixels)
    && baseline.maxDiffPixels >= 0
    && baseline.maxDiffPixels <= 1_000_000
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
}

function isReservedEnvironmentKey(key: string): boolean {
  return key === "PATH"
    || key === "HOME"
    || key === "XDG_CONFIG_HOME"
    || key === "XDG_CACHE_HOME"
    || key === "PI_CODING_AGENT_DIR"
    || key === "GEMINI_API_KEY"
    || key === "BORING_UI_REVIEW_MODEL"
    || key.startsWith("UI_REVIEW_")
}

function isRepoPath(value: string): boolean {
  return !isAbsolute(value)
    && !value.split(/[\\/]/).includes("..")
    && !value.includes("\0")
    && Boolean(value.trim())
}
