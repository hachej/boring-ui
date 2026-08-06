import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const validationScript = fileURLToPath(new URL("./fixtures/bsl_worker_validation.py", import.meta.url))

describe("bsl_worker validation", () => {
  it("classifies invalid and non-tabular results while isolating ordered batch failures", () => {
    const result = spawnSync("python3", [validationScript], { encoding: "utf8" })

    expect(result.status, result.stderr || result.stdout).toBe(0)
  })
})
