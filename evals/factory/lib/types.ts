/**
 * Shared result shapes for the factory eval suite (evals/factory/).
 *
 * Every eval module exports a `run()` that returns one `EvalModuleResult`
 * containing one or more `EvalCheckResult`s. A single eval (e.g.
 * eval-surface-control) may report multiple checks — a deterministic
 * "structural" check that never touches a model, and a "live" check gated
 * behind FACTORY_EVALS_LIVE=1 that exercises the real model. The runner
 * flattens and prints all checks; a module's overall status is the worst of
 * its checks (fail > skip > pass).
 */

export type EvalStatus = "pass" | "fail" | "skip"

export interface EvalCheckResult {
  /** Stable id, e.g. "eval-boot.compose" or "eval-boot.live-turn". */
  id: string
  /** Human label shown in the table. */
  label: string
  status: EvalStatus
  /** Free-form detail: failure reason, skip reason, or a short pass note. */
  detail?: string
  /** True if this check calls a real model (gated by FACTORY_EVALS_LIVE). */
  live: boolean
  durationMs?: number
}

export interface EvalModuleResult {
  /** Eval id from the spec, e.g. "eval-objective-understanding". */
  evalId: string
  title: string
  checks: EvalCheckResult[]
}

export type EvalModule = {
  evalId: string
  title: string
  run(): Promise<EvalModuleResult>
}
