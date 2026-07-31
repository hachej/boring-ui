import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { validateReleaseResumeState } from "./validate-release-resume.mjs"

const valid = {
  version: "0.1.94",
  parentVersion: "0.1.93",
  commitSubject: "chore(release): bump packages to 0.1.94",
  changedFiles: ["package.json", "packages/agent/package.json"],
  allowedFiles: ["package.json", "packages/agent/package.json", "pnpm-lock.yaml"],
  tagsAtHead: [],
}

describe("release resume validation", () => {
  test("accepts a cleanly shaped untagged version bump commit", () => {
    assert.doesNotThrow(() => validateReleaseResumeState(valid))
  })

  test("rejects a non-bump commit or unchanged version", () => {
    assert.throws(() => validateReleaseResumeState({
      ...valid,
      parentVersion: valid.version,
      commitSubject: "fix: unrelated",
    }), /does not change.*not the expected release bump/s)
  })

  test("rejects unexpected files in the bump commit", () => {
    assert.throws(() => validateReleaseResumeState({
      ...valid,
      changedFiles: [...valid.changedFiles, "src/product.ts"],
    }), /unexpected file: src\/product.ts/)
  })

  test("rejects an already tagged bump", () => {
    assert.throws(() => validateReleaseResumeState({
      ...valid,
      tagsAtHead: ["v0.1.94"],
    }), /already tagged/)
  })
})
