#!/usr/bin/env -S tsx
/**
 * Factory eval suite runner. See docs at the top of each evals/factory/
 * checks/*.ts module for what each eval actually asserts.
 *
 * Usage:
 *   pnpm evals:factory                 # deterministic subset (no model)
 *   FACTORY_EVALS_LIVE=1 pnpm evals:factory   # everything, incl. live model
 *   pnpm evals:factory --json          # JSON report instead of a table
 */
import * as evalBoot from "./checks/01-boot"
import * as evalObjectiveUnderstanding from "./checks/02-objective-understanding"
import * as evalToolSelection from "./checks/03-tool-selection"
import * as evalEvidenceDiscipline from "./checks/04-evidence-discipline"
import * as evalApprovalDiscipline from "./checks/05-approval-discipline"
import * as evalResume from "./checks/06-resume"
import * as evalSurfaceControl from "./checks/07-surface-control"
import * as evalProductIsolation from "./checks/08-product-isolation"
import { printReport, printJson, overallExitCode } from "./lib/report"
import { LIVE_ENABLED } from "./lib/harness"
import type { EvalModuleResult } from "./lib/types"

const MODULES = [
  evalBoot,
  evalObjectiveUnderstanding,
  evalToolSelection,
  evalEvidenceDiscipline,
  evalApprovalDiscipline,
  evalResume,
  evalSurfaceControl,
  evalProductIsolation,
]

async function main(): Promise<number> {
  const json = process.argv.includes("--json")
  if (!json) {
    console.log(`[factory evals] FACTORY_EVALS_LIVE=${LIVE_ENABLED ? "1 (live checks will run)" : "unset (live checks skipped)"}`)
    console.log("")
  }

  const results: EvalModuleResult[] = []
  for (const mod of MODULES) {
    try {
      results.push(await mod.run())
    } catch (err) {
      results.push({
        evalId: mod.evalId,
        title: mod.title,
        checks: [
          {
            id: `${mod.evalId}.crash`,
            label: "eval module threw before producing a result",
            status: "fail",
            live: false,
            detail: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
          },
        ],
      })
    }
  }

  if (json) {
    printJson(results)
  } else {
    printReport(results)
  }
  return overallExitCode(results)
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[factory evals] fatal:", err)
    process.exit(2)
  },
)
