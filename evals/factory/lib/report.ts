import type { EvalCheckResult, EvalModuleResult } from "./types"

const STATUS_LABEL: Record<EvalCheckResult["status"], string> = {
  pass: "PASS",
  fail: "FAIL",
  skip: "SKIPPED",
}

export function printReport(results: EvalModuleResult[]): void {
  const rows: Array<{ eval: string; check: string; live: string; status: string; detail: string }> = []
  for (const module of results) {
    for (const check of module.checks) {
      rows.push({
        eval: module.evalId,
        check: check.label,
        live: check.live ? "live" : "det.",
        status: STATUS_LABEL[check.status],
        detail: check.detail ?? "",
      })
    }
  }

  const cols: Array<keyof (typeof rows)[number]> = ["eval", "check", "live", "status", "detail"]
  const headers: Record<string, string> = {
    eval: "EVAL",
    check: "CHECK",
    live: "KIND",
    status: "STATUS",
    detail: "DETAIL",
  }
  const widths = cols.map((col) =>
    Math.max(headers[col].length, ...rows.map((r) => truncate(r[col], col === "detail" ? 80 : 40).length)),
  )

  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ")
  console.log(line(cols.map((c) => headers[c])))
  console.log(widths.map((w) => "-".repeat(w)).join("  "))
  for (const r of rows) {
    console.log(line(cols.map((c) => truncate(String(r[c]), c === "detail" ? 80 : 40))))
  }

  const total = rows.length
  const passed = rows.filter((r) => r.status === "PASS").length
  const failed = rows.filter((r) => r.status === "FAIL").length
  const skipped = rows.filter((r) => r.status === "SKIPPED").length
  console.log("")
  console.log(`${passed}/${total} passed, ${failed} failed, ${skipped} skipped`)
}

export function printJson(results: EvalModuleResult[]): void {
  console.log(JSON.stringify({ results, generatedAt: new Date().toISOString() }, null, 2))
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function overallExitCode(results: EvalModuleResult[]): number {
  const anyFailed = results.some((m) => m.checks.some((c) => c.status === "fail"))
  return anyFailed ? 1 : 0
}
