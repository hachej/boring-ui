import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  classifyReleaseCandidateCheck,
  selectLatestReleaseCandidateCheck,
  waitForReleaseCandidateCheck,
} from "./require-release-candidate-check.mjs"

const sha = "a".repeat(40)
const otherSha = "b".repeat(40)

function check(overrides = {}) {
  return {
    id: 100,
    name: "Release Candidate Built-Dist",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
    app: { slug: "github-actions" },
    ...overrides,
  }
}

function payload(...checks) {
  return { check_runs: checks }
}

describe("release-candidate check selection", () => {
  test("treats a missing exact check as waiting", () => {
    assert.deepEqual(classifyReleaseCandidateCheck(selectLatestReleaseCandidateCheck(payload(), sha)), {
      state: "waiting",
      description: "check has not been created",
    })
  })

  test("ignores checks with the wrong SHA, name, or app", () => {
    const selected = selectLatestReleaseCandidateCheck(payload(
      check({ id: 101, head_sha: otherSha }),
      check({ id: 102, name: "Main Green Summary" }),
      check({ id: 103, app: { slug: "external-ci" } }),
    ), sha)
    assert.equal(selected, null)
  })

  test("classifies queued and in-progress checks as waiting", () => {
    for (const status of ["queued", "in_progress"]) {
      assert.equal(classifyReleaseCandidateCheck(check({ status, conclusion: null })).state, "waiting")
    }
  })

  test("accepts only completed success", () => {
    assert.equal(classifyReleaseCandidateCheck(check()).state, "success")
  })

  test("fails completed failure and cancellation", () => {
    for (const conclusion of ["failure", "cancelled"]) {
      assert.equal(classifyReleaseCandidateCheck(check({ conclusion })).state, "failure")
    }
  })

  test("uses the latest exact-name rerun rather than an older success", () => {
    const selected = selectLatestReleaseCandidateCheck(payload(
      check({ id: 200, conclusion: "success" }),
      check({ id: 201, conclusion: "failure" }),
    ), sha)
    assert.equal(selected.id, 201)
    assert.equal(classifyReleaseCandidateCheck(selected).state, "failure")
  })
})

describe("release-candidate check polling", () => {
  test("polls missing and in-progress fixtures until success", async () => {
    const fixtures = [
      payload(),
      payload(check({ id: 201, status: "in_progress", conclusion: null })),
      payload(check({ id: 201 })),
    ]
    let now = 0
    const result = await waitForReleaseCandidateCheck({
      sha,
      timeoutMs: 10,
      pollIntervalMs: 1,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      loadChecks: async () => fixtures.shift(),
      log: () => {},
    })
    assert.equal(result.id, 201)
  })

  test("fails immediately on the latest failure or cancellation fixture", async () => {
    for (const conclusion of ["failure", "cancelled"]) {
      await assert.rejects(
        waitForReleaseCandidateCheck({
          sha,
          loadChecks: async () => payload(check({ conclusion })),
          log: () => {},
        }),
        new RegExp(conclusion),
      )
    }
  })

  test("times out fail-closed when only wrong SHA/name fixtures exist", async () => {
    let now = 0
    await assert.rejects(
      waitForReleaseCandidateCheck({
        sha,
        timeoutMs: 2,
        pollIntervalMs: 1,
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds },
        loadChecks: async () => payload(
          check({ head_sha: otherSha }),
          check({ name: "Release Candidate" }),
        ),
        log: () => {},
      }),
      /Timed out.*check has not been created/,
    )
  })
})
