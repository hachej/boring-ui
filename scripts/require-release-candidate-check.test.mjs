import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  MAIN_GREEN_CHECK_NAME,
  RELEASE_CANDIDATE_CHECK_NAME,
  classifyRequiredCheck,
  selectLatestRequiredCheck,
  waitForRequiredChecks,
} from "./require-release-candidate-check.mjs"

const sha = "a".repeat(40)
const otherSha = "b".repeat(40)

function check(overrides = {}) {
  return {
    id: 100,
    name: RELEASE_CANDIDATE_CHECK_NAME,
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

describe("required check selection", () => {
  test("treats a missing exact check as waiting", () => {
    assert.deepEqual(classifyRequiredCheck(selectLatestRequiredCheck(payload(), sha, RELEASE_CANDIDATE_CHECK_NAME)), {
      state: "waiting",
      description: "check has not been created",
    })
  })

  test("ignores checks with the wrong SHA, name, or app", () => {
    const selected = selectLatestRequiredCheck(payload(
      check({ id: 101, head_sha: otherSha }),
      check({ id: 102, name: MAIN_GREEN_CHECK_NAME }),
      check({ id: 103, app: { slug: "external-ci" } }),
    ), sha, RELEASE_CANDIDATE_CHECK_NAME)
    assert.equal(selected, null)
  })

  test("classifies queued and in-progress checks as waiting", () => {
    for (const status of ["queued", "in_progress"]) {
      assert.equal(classifyRequiredCheck(check({ status, conclusion: null })).state, "waiting")
    }
  })

  test("accepts only completed success", () => {
    assert.equal(classifyRequiredCheck(check()).state, "success")
  })

  test("fails completed failure and cancellation", () => {
    for (const conclusion of ["failure", "cancelled"]) {
      assert.equal(classifyRequiredCheck(check({ conclusion })).state, "failure")
    }
  })

  test("uses the latest exact-name rerun rather than an older success", () => {
    const selected = selectLatestRequiredCheck(payload(
      check({ id: 200, conclusion: "success" }),
      check({ id: 201, conclusion: "failure" }),
    ), sha, RELEASE_CANDIDATE_CHECK_NAME)
    assert.equal(selected.id, 201)
    assert.equal(classifyRequiredCheck(selected).state, "failure")
  })
})

describe("required check polling", () => {
  test("waits for both exact required names on the same SHA", async () => {
    const fixtures = new Map([
      [RELEASE_CANDIDATE_CHECK_NAME, [payload(), payload(check({ id: 201 }))]],
      [MAIN_GREEN_CHECK_NAME, [payload(check({ id: 301, name: MAIN_GREEN_CHECK_NAME, status: "in_progress", conclusion: null })), payload(check({ id: 301, name: MAIN_GREEN_CHECK_NAME }))]],
    ])
    let now = 0
    const result = await waitForRequiredChecks({
      sha,
      names: [RELEASE_CANDIDATE_CHECK_NAME, MAIN_GREEN_CHECK_NAME],
      timeoutMs: 10,
      pollIntervalMs: 1,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      loadChecks: async (name) => fixtures.get(name).shift(),
      log: () => {},
    })
    assert.equal(result.get(RELEASE_CANDIDATE_CHECK_NAME).id, 201)
    assert.equal(result.get(MAIN_GREEN_CHECK_NAME).id, 301)
  })

  test("revalidates an earlier success while another required check is pending", async () => {
    const fixtures = new Map([
      [RELEASE_CANDIDATE_CHECK_NAME, [payload(check({ id: 201 })), payload(check({ id: 202, conclusion: "failure" }))]],
      [MAIN_GREEN_CHECK_NAME, [payload(check({ id: 301, name: MAIN_GREEN_CHECK_NAME, status: "in_progress", conclusion: null }))]],
    ])
    let now = 0
    await assert.rejects(waitForRequiredChecks({
      sha,
      names: [RELEASE_CANDIDATE_CHECK_NAME, MAIN_GREEN_CHECK_NAME],
      timeoutMs: 10,
      pollIntervalMs: 1,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds },
      loadChecks: async (name) => fixtures.get(name).shift(),
      log: () => {},
    }), /Release Candidate Built-Dist.*failure/)
  })

  test("fails immediately when either latest required check fails or is cancelled", async () => {
    for (const conclusion of ["failure", "cancelled"]) {
      await assert.rejects(
        waitForRequiredChecks({
          sha,
          names: [RELEASE_CANDIDATE_CHECK_NAME, MAIN_GREEN_CHECK_NAME],
          loadChecks: async (name) => payload(check({ name, conclusion: name === MAIN_GREEN_CHECK_NAME ? conclusion : "success" })),
          log: () => {},
        }),
        new RegExp(`${MAIN_GREEN_CHECK_NAME}.*${conclusion}`),
      )
    }
  })

  test("times out fail-closed when only wrong SHA/name fixtures exist", async () => {
    let now = 0
    await assert.rejects(
      waitForRequiredChecks({
        sha,
        names: [RELEASE_CANDIDATE_CHECK_NAME],
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

  test("rejects missing or duplicate required names", async () => {
    for (const names of [[], [MAIN_GREEN_CHECK_NAME, MAIN_GREEN_CHECK_NAME]]) {
      await assert.rejects(waitForRequiredChecks({ sha, names, loadChecks: async () => payload() }))
    }
  })
})
