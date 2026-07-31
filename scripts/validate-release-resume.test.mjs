import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  validateReleaseResumeState,
  validateReleaseTagState,
} from "./validate-release-resume.mjs"

const valid = {
  version: "0.1.94",
  parentVersion: "0.1.93",
  commitSubject: "chore(release): bump packages to 0.1.94",
  changedFiles: ["package.json", "packages/agent/package.json"],
  allowedFiles: ["package.json", "packages/agent/package.json", "pnpm-lock.yaml"],
}

describe("post-tag release resume validation", () => {
  const releaseSha = "a".repeat(40)

  test("accepts either a fully untagged state or matching local and remote tags", () => {
    assert.equal(validateReleaseTagState({
      releaseSha,
      localTagSha: null,
      remoteTagSha: null,
      releaseExists: false,
    }), "untagged")
    assert.equal(validateReleaseTagState({
      releaseSha,
      localTagSha: releaseSha,
      remoteTagSha: releaseSha,
      releaseExists: false,
    }), "tagged")
  })

  test("rejects one-sided tags, mismatched targets, or an existing GitHub release", () => {
    const invalid = [
      { localTagSha: releaseSha, remoteTagSha: null, releaseExists: false },
      { localTagSha: releaseSha, remoteTagSha: "b".repeat(40), releaseExists: false },
      { localTagSha: releaseSha, remoteTagSha: releaseSha, releaseExists: true },
    ]
    for (const state of invalid) {
      assert.throws(() => validateReleaseTagState({ releaseSha, ...state }))
    }
  })
})

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
})
