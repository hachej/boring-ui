import { spawn } from "node:child_process"
import type { UiCriticCandidateReport, UiHardGateReport, UiReviewManifest, UiScore } from "./contracts"
import { UI_REVIEW_SCHEMA_VERSION, validateUiCriticReport } from "./contracts"
import { validateCommandPaletteHardGateReport } from "./hardGates"

export const DEFAULT_UI_REVIEW_MODEL = "google/gemini-3.1-pro-preview"

export type PiCriticInvocation = {
  command: "pi"
  args: string[]
  env: NodeJS.ProcessEnv
}

export function createFixtureCriticReport(manifest: UiReviewManifest): UiCriticCandidateReport {
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
  return {
    schemaVersion: UI_REVIEW_SCHEMA_VERSION,
    mode: "candidate",
    confidence: 1,
    candidate: score,
    visualFindings: stateIds.length > 0 ? [{ stateIds: [stateIds[0]!], evidence: "Deterministic fixture critic.", severity: "note" }] : [],
    topFixes: [],
  }
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

export function assertHardGatesPermitLiveCritic(hardGates: UiHardGateReport, manifest: UiReviewManifest): void {
  validateCommandPaletteHardGateReport(hardGates, manifest)
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
      first,
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
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8") })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`UI_REVIEW_CRITIC_FAILED:${code ?? "unknown"}:${stderr.slice(0, 500)}`))
    })
  })
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return JSON.parse(fenced?.[1] ?? trimmed)
}
