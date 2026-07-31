#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export const RELEASE_CANDIDATE_CHECK_NAME = "Release Candidate Built-Dist"
export const MAIN_GREEN_CHECK_NAME = "Main Green Summary"
export const DEFAULT_REQUIRED_CHECK_NAMES = [
  RELEASE_CANDIDATE_CHECK_NAME,
  MAIN_GREEN_CHECK_NAME,
]

function checkId(check) {
  try {
    return BigInt(check.id)
  } catch {
    throw new Error(`Required check has an invalid id: ${String(check.id)}`)
  }
}

export function selectLatestRequiredCheck(payload, sha, name) {
  if (!payload || !Array.isArray(payload.check_runs)) {
    throw new Error("GitHub check-runs response is missing check_runs")
  }

  const matches = payload.check_runs.filter((check) =>
    check?.name === name
    && check?.head_sha === sha
    && check?.app?.slug === "github-actions"
  )
  if (matches.length === 0) return null

  return matches.reduce((latest, check) => checkId(check) > checkId(latest) ? check : latest)
}

export function classifyRequiredCheck(check) {
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

export async function waitForRequiredChecks({
  sha,
  names,
  loadChecks,
  timeoutMs = 45 * 60 * 1_000,
  pollIntervalMs = 15_000,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  log = console.log,
}) {
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("At least one exact required check name is required")
  }
  if (new Set(names).size !== names.length) throw new Error("Required check names must be unique")

  const startedAt = now()
  let lastWaiting = "checks have not been queried"

  while (true) {
    const currentSuccesses = new Map()
    const waiting = []
    for (const name of names) {
      const payload = await loadChecks(name)
      const check = selectLatestRequiredCheck(payload, sha, name)
      const classification = classifyRequiredCheck(check)
      if (classification.state === "success") {
        currentSuccesses.set(name, check)
      } else if (classification.state === "failure") {
        throw new Error(`Required check "${name}" failed: ${classification.description}`)
      } else {
        waiting.push(`${name}: ${classification.description}`)
      }
    }

    if (currentSuccesses.size === names.length) return currentSuccesses
    lastWaiting = waiting.join("; ") || lastWaiting
    const elapsed = now() - startedAt
    if (elapsed >= timeoutMs) {
      throw new Error(`Timed out waiting for required checks on ${sha}: ${lastWaiting}`)
    }
    log(`Waiting for required checks on ${sha}: ${lastWaiting}`)
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
  const names = process.argv.slice(3)
  const repository = process.env.GH_REPOSITORY
  if (!/^[0-9a-f]{40}$/i.test(sha ?? "") || names.length === 0) {
    throw new Error("Usage: require-release-candidate-check.mjs <40-character-release-sha> <exact-check-name> [...]")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GH_REPOSITORY must be set to owner/repository")
  }

  const timeoutMs = positiveNumber(process.env.RELEASE_CHECK_TIMEOUT_SECONDS, 45 * 60, "RELEASE_CHECK_TIMEOUT_SECONDS") * 1_000
  const pollIntervalMs = positiveNumber(process.env.RELEASE_CHECK_POLL_SECONDS, 15, "RELEASE_CHECK_POLL_SECONDS") * 1_000
  const actionsUrl = `https://github.com/${repository}/actions?query=${encodeURIComponent(`head_sha:${sha}`)}`
  console.log(`Requiring exact checks for ${repository}@${sha}: ${names.join(", ")}`)
  console.log(`Actions: ${actionsUrl}`)

  const passed = await waitForRequiredChecks({
    sha,
    names,
    timeoutMs,
    pollIntervalMs,
    loadChecks: (name) => {
      const endpoint = `repos/${repository}/commits/${sha}/check-runs?check_name=${encodeURIComponent(name)}&filter=all&per_page=100`
      const output = execFileSync("gh", ["api", "--method", "GET", endpoint], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      })
      return JSON.parse(output)
    },
  })
  for (const name of names) {
    console.log(`Required check green: ${name}: ${passed.get(name)?.html_url ?? actionsUrl}`)
  }
}

const isDirectInvocation = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
