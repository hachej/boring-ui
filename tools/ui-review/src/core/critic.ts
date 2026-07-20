import { spawn } from "node:child_process"
import type { UiCriticReport, UiHardGateReport, UiReviewManifest, UiScore } from "./contracts"
import { UI_REVIEW_SCHEMA_VERSION, validateUiCriticReport } from "./contracts"
import type { UiReviewSpec } from "./reviewSpec"

export const DEFAULT_UI_REVIEW_MODEL = "google/gemini-3.1-pro-preview"
export const UI_REVIEW_CRITIC_TIMEOUT_MS = 180_000
export const UI_REVIEW_CRITIC_MAX_OUTPUT_BYTES = 512 * 1024
export const UI_REVIEW_CRITIC_MAX_REPAIR_CONTEXT_BYTES = 32 * 1024
export type PiCriticInvocation = {
  command: "pi"
  args: string[]
  env: NodeJS.ProcessEnv
}

export function createFixtureCriticReport(manifest: UiReviewManifest): UiCriticReport {
  const score: UiScore = {
    overall: 8,
    dimensions: {
      hierarchy: 8,
      spacingAlignment: 8,
      typographyColor: 8,
      consistency: 8,
      interactionStates: 8,
      responsiveAccessibility: 8,
    },
  }
  const stateIds = manifest.states.map((state) => state.id)
  const common = {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    confidence: 1,
    candidate: score,
    visualFindings: stateIds.length > 0 ? [{ stateIds: [stateIds[0]!], evidence: "Deterministic fixture critic.", severity: "note" as const }] : [],
    topFixes: [],
  }
  return manifest.statePairs.length > 0
    ? { ...common, mode: "pair", baseline: score }
    : { ...common, mode: "candidate" }
}

export function buildPiCriticInvocation(input: {
  model?: string
  apiKey: string
  tempHome: string
  tempConfig: string
  systemPrompt: string
  criticPromptPath: string
  manifestPath: string
  schemaPath: string
  hardGatesPath: string
  contextPaths?: string[]
  screenshotPaths: string[]
}): PiCriticInvocation {
  if (!input.apiKey.trim()) throw new Error("UI_REVIEW_CRITIC_CREDENTIAL_MISSING")
  if (input.screenshotPaths.length === 0) throw new Error("UI_REVIEW_CRITIC_SCREENSHOTS_MISSING")
  const pathValue = process.env.PATH
  if (!pathValue) throw new Error("UI_REVIEW_CRITIC_PATH_MISSING")
  return {
    command: "pi",
    args: [
      "--print",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-approve",
      "--system-prompt",
      input.systemPrompt,
      "--model",
      input.model ?? DEFAULT_UI_REVIEW_MODEL,
      `@${input.criticPromptPath}`,
      `@${input.manifestPath}`,
      `@${input.schemaPath}`,
      `@${input.hardGatesPath}`,
      ...(input.contextPaths ?? []).map((path) => `@${path}`),
      ...input.screenshotPaths.map((path) => `@${path}`),
    ],
    env: {
      PATH: pathValue,
      HOME: input.tempHome,
      GEMINI_API_KEY: input.apiKey,
      PI_CODING_AGENT_DIR: input.tempConfig,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
    },
  }
}

export function assertHardGatesPermitLiveCritic(hardGates: UiHardGateReport, manifest: UiReviewManifest, spec: UiReviewSpec): void {
  spec.hardGates.validate(hardGates, manifest)
  const failedStateIds = [...new Set(hardGates.results.filter((result) => !result.passed).map((result) => result.stateId))]
  if (failedStateIds.length > 0) throw new Error(`UI_REVIEW_HARD_GATES_FAILED:${failedStateIds.join(",")}`)
}

export async function runPiCritic(invocation: PiCriticInvocation, manifest: UiReviewManifest): Promise<ReturnType<typeof validateUiCriticReport>> {
  const first = await run(invocation, [])
  try {
    return validateUiCriticReport(parseJsonOutput(first), manifest)
  } catch (error) {
    const repairPrompt = [
      "Return only valid JSON matching the requested schema. Do not add Markdown fences.",
      `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      "Previous output:",
      truncateUtf8(first, UI_REVIEW_CRITIC_MAX_REPAIR_CONTEXT_BYTES),
    ].join("\n")
    const repaired = await run(invocation, [repairPrompt])
    return validateUiCriticReport(parseJsonOutput(repaired), manifest)
  }
}

async function run(invocation: PiCriticInvocation, extraArgs: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, [...invocation.args, ...extraArgs], {
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let outputBytes = 0
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(stdout.trim())
    }
    const terminate = (error: Error) => {
      if (settled) return
      child.kill("SIGTERM")
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 2_000)
      forceKill.unref()
      finish(error)
    }
    const collect = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (settled) return
      outputBytes += chunk.byteLength
      if (outputBytes > UI_REVIEW_CRITIC_MAX_OUTPUT_BYTES) {
        terminate(new Error("UI_REVIEW_CRITIC_OUTPUT_LIMIT"))
        return
      }
      if (target === "stdout") stdout += chunk.toString("utf8")
      else stderr += chunk.toString("utf8")
    }
    const timeout = setTimeout(() => terminate(new Error("UI_REVIEW_CRITIC_TIMEOUT")), UI_REVIEW_CRITIC_TIMEOUT_MS)
    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk))
    child.on("error", (error) => finish(error))
    child.on("exit", (code) => {
      if (settled) return
      if (code === 0) finish()
      else finish(new Error(`UI_REVIEW_CRITIC_FAILED:${code ?? "unknown"}:${stderr.slice(0, 500)}`))
    })
  })
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value)
  return bytes.byteLength <= maximumBytes ? value : bytes.subarray(0, maximumBytes).toString("utf8")
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return JSON.parse(fenced?.[1] ?? trimmed)
}
