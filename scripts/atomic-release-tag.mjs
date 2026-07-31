#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

function defaultRunGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

function firstSha(output) {
  return output.trim().split(/\s+/, 1)[0] || null
}

export function atomicReleaseRefspecs(releaseSha, tag) {
  return [
    "push",
    "--atomic",
    `--force-with-lease=refs/heads/main:${releaseSha}`,
    "origin",
    `${releaseSha}:refs/heads/main`,
    `refs/tags/${tag}:refs/tags/${tag}`,
  ]
}

export function pushAnnotatedReleaseTagAtomically({ releaseSha, tag, runGit = defaultRunGit }) {
  const created = runGit(["tag", "-a", tag, releaseSha, "-m", tag])
  if (created.status !== 0) {
    throw new Error(`Could not create local annotated release tag ${tag}: ${created.stderr.trim()}`)
  }

  const localTagObject = runGit(["rev-parse", `refs/tags/${tag}`])
  const createdTagObjectSha = localTagObject.status === 0 ? firstSha(localTagObject.stdout) : null
  if (!createdTagObjectSha) {
    throw new Error(`Could not capture the annotated tag object for ${tag}; keeping the local tag for investigation.`)
  }

  const pushed = runGit(atomicReleaseRefspecs(releaseSha, tag))
  if (pushed.status === 0) return

  const remoteTag = runGit([
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ])
  const remoteMain = runGit(["ls-remote", "--exit-code", "--heads", "origin", "refs/heads/main"])

  // Compare-and-delete only the exact tag object created by this invocation
  // when the remote authoritatively proves the atomic push created no tag.
  // A concurrent same-target replacement has a different tag object SHA and
  // is therefore retained for investigation.
  if (remoteTag.status === 2) {
    runGit(["update-ref", "-d", `refs/tags/${tag}`, createdTagObjectSha])
  }

  const remoteMainSha = remoteMain.status === 0 ? firstSha(remoteMain.stdout) : null
  if (remoteMainSha && remoteMainSha !== releaseSha) {
    throw new Error(
      `Atomic release tag push failed because origin/main advanced from ${releaseSha} to ${remoteMainSha}; no release was created.`,
    )
  }
  if (remoteTag.status === 0) {
    throw new Error(
      `Atomic release tag push reported failure but ${tag} exists remotely; keep the local tag and run ./scripts/cut-release.sh --resume.`,
    )
  }
  throw new Error(`Atomic release tag push failed: ${pushed.stderr.trim()}`)
}

function main() {
  const [releaseSha, tag] = process.argv.slice(2)
  if (!/^[0-9a-f]{40}$/i.test(releaseSha ?? "") || !/^v[0-9A-Za-z.+-]+$/.test(tag ?? "")) {
    throw new Error("Usage: atomic-release-tag.mjs <40-character-release-sha> <version-tag>")
  }
  pushAnnotatedReleaseTagAtomically({ releaseSha, tag })
  console.log(`Atomically asserted main and pushed annotated tag ${tag} at ${releaseSha}.`)
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectInvocation) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
