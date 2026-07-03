import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { validateDashboardSpec } from "../shared/validation"

const __dirname = dirname(fileURLToPath(import.meta.url))

describe("dashboard examples", () => {
  it("validates checked-in dashboard examples", () => {
    const examplesRoot = resolve(__dirname, "../../example/dashboards")
    for (const file of [
      "people.dashboard.json",
      "warden-benchmark.dashboard.json",
      "random-retail-duckdb.dashboard.json",
      "openui-chart-showcase.dashboard.json",
    ]) {
      const spec = JSON.parse(readFileSync(resolve(examplesRoot, file), "utf8"))
      const result = validateDashboardSpec(spec)
      expect(result, file).toEqual({ ok: true, errors: [] })
    }
  })
})
