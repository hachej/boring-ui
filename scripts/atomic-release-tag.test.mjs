import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  atomicReleaseRefspecs,
  pushAnnotatedReleaseTagAtomically,
} from "./atomic-release-tag.mjs"

const releaseSha = "a".repeat(40)
const advancedSha = "b".repeat(40)
const tag = "v0.1.94"

function fixtureRunner(fixtures, calls) {
  return (args) => {
    calls.push(args)
    const fixture = fixtures.shift()
    assert.ok(fixture, `unexpected git call: ${args.join(" ")}`)
    return { stdout: "", stderr: "", ...fixture }
  }
}

describe("atomic release tag push", () => {
  test("pushes a main assertion and annotated tag in one atomic transaction", () => {
    assert.deepEqual(atomicReleaseRefspecs(releaseSha, tag), [
      "push",
      "--atomic",
      `--force-with-lease=refs/heads/main:${releaseSha}`,
      "origin",
      `${releaseSha}:refs/heads/main`,
      `refs/tags/${tag}:refs/tags/${tag}`,
    ])
    const calls = []
    pushAnnotatedReleaseTagAtomically({
      releaseSha,
      tag,
      runGit: fixtureRunner([{ status: 0 }, { status: 0 }], calls),
    })
    assert.deepEqual(calls[0], ["tag", "-a", tag, releaseSha, "-m", tag])
  })

  test("fails when main advanced and safely removes an unpushed local tag", () => {
    const calls = []
    const runGit = fixtureRunner([
      { status: 0 },
      { status: 1, stderr: "atomic push rejected" },
      { status: 2 },
      { status: 0, stdout: `${advancedSha}\trefs/heads/main\n` },
      { status: 0, stdout: `${releaseSha}\n` },
      { status: 0 },
    ], calls)
    assert.throws(
      () => pushAnnotatedReleaseTagAtomically({ releaseSha, tag, runGit }),
      /origin\/main advanced/,
    )
    assert.deepEqual(calls.at(-1), ["tag", "-d", tag])
  })

  test("keeps the local tag when remote tag state cannot be proven absent", () => {
    const calls = []
    const runGit = fixtureRunner([
      { status: 0 },
      { status: 1, stderr: "connection lost" },
      { status: 1, stderr: "connection lost" },
      { status: 1, stderr: "connection lost" },
    ], calls)
    assert.throws(
      () => pushAnnotatedReleaseTagAtomically({ releaseSha, tag, runGit }),
      /Atomic release tag push failed/,
    )
    assert.equal(calls.some((args) => args[0] === "tag" && args[1] === "-d"), false)
  })
})
