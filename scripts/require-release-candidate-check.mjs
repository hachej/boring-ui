#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export const RELEASE_CANDIDATE_CHECK_NAME = "Release Candidate Built-Dist"

function checkId(check) {
  try {
    return BigInt(check.id)
  } catch {
    throw new Error(`Release-candidate check has an invalid id: ${String(check.id)}`)
  }
}

export function selectLatestReleaseCandidateCheck(payload, sha) {
  if (!payload || !Array.isArray(payload.check_runs)) {
    throw new Error("GitHub check-runs response is missing check_runs")
  }

  const matches = payload.check_runs.filter((check) =>
    check?.name === RELEASE_CANDIDATE_CHECK_NAME
    && check?.head_sha === sha
    && check?.app?.slug === "github-actions"
  )
  if (matches.length === 0) return null

  return matches.reduce((latest, check) => checkId(check) > checkId(latest) ? check : latest)
}

export function classifyReleaseCandidateCheck(check) {
  if (!check) return { state: "waiting", description: "check has not been created" }
  if (check.status !== "completed") {
    return { state: "waiting", description: `latest check ${check.id} is ${check.status}` }
  }
  if (check.conclusion === "success") {
    return { state: "success", description: `check ${check.id} completed successfully` }
  }
  return {
    state: "failure",
    description: `latest check ${check.id} completed with ${check.conclusion ?? "no conclusion"}`,
  }
}

export async function waitForReleaseCandidateCheck({
  sha,
  loadChecks,
  timeoutMs = 30 * 60 * 1_000,
  pollIntervalMs = 15_000,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  log = console.log,
}) {
  const startedAt = now()
  let lastDescription = "check has not been queried"

  while (true) {
    const payload = await loadChecks()
    const check = selectLatestReleaseCandidateCheck(payload, sha)
    const classification = classifyReleaseCandidateCheck(check)
    lastDescription = classification.description

    if (classification.state === "success") return check
    if (classification.state === "failure") {
      throw new Error(`Release-candidate gate failed: ${classification.description}`)
    }

    const elapsed = now() - startedAt
    if (elapsed >= timeoutMs) {
      throw new Error(`Timed out waiting for ${RELEASE_CANDIDATE_CHECK_NAME} on ${sha}: ${lastDescription}`)
    }
    log(`Waiting for ${RELEASE_CANDIDATE_CHECK_NAME} on ${sha}: ${lastDescription}`)
    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsed))
  }
}

function positiveNumber(value, fallback, name) {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

async function main() {
  const sha = process.argv[2]
  const repository = process.env.GH_REPOSITORY
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) {
    throw new Error("Usage: require-release-candidate-check.mjs <40-character-release-sha>")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GH_REPOSITORY must be set to owner/repository")
  }

  const timeoutMs = positiveNumber(process.env.RELEASE_CHECK_TIMEOUT_SECONDS, 30 * 60, "RELEASE_CHECK_TIMEOUT_SECONDS") * 1_000
  const pollIntervalMs = positiveNumber(process.env.RELEASE_CHECK_POLL_SECONDS, 15, "RELEASE_CHECK_POLL_SECONDS") * 1_000
  const endpoint = `repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(RELEASE_CANDIDATE_CHECK_NAME)}&filter=all&per_page=100`
  const actionsUrl = `https://github.com/${repository}/actions?query=${encodeURIComponent(`head_sha:${sha}`)}`
  console.log(`Requiring exact check "${RELEASE_CANDIDATE_CHECK_NAME}" for ${repository}@${sha}`)
  console.log(`Actions: ${actionsUrl}`)

  const check = await waitForReleaseCandidateCheck({
    sha,
    timeoutMs,
    pollIntervalMs,
    loadChecks: () => {
      const output = execFileSync("gh", ["api", "--method", "GET", endpoint], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      })
      return JSON.parse(output)
    },
  })
  console.log(`Release-candidate gate passed: ${check.html_url ?? actionsUrl}`)
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
