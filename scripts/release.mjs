#!/usr/bin/env node
/**
 * One-command stable release.
 *
 * Usage:
 *   node scripts/release.mjs patch [--force-ci]
 *   node scripts/release.mjs minor [--force-ci]
 *   node scripts/release.mjs major [--force-ci]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const bump = process.argv.find((arg) => ["patch", "minor", "major"].includes(arg)) ?? "patch"
const forceCi = process.argv.includes("--force-ci")

const publishable = [
  "packages/core",
  "packages/workspace",
  "packages/agent",
  "packages/ui",
  "packages/cli",
  "plugins/deck",
  "plugins/ask-user",
  "plugins/data-explorer",
  "plugins/data-catalog",
]

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`)
  return execFileSync(command, args, { stdio: "inherit", ...options })
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function assertCleanTree() {
  const status = output("git", ["status", "--porcelain"])
  if (status) {
    throw new Error(`Release requires a clean tree. Dirty files:\n${status}`)
  }
}

function assertOnMain() {
  const branch = output("git", ["branch", "--show-current"])
  if (branch !== "main") throw new Error(`Release must run on main; got ${branch || "detached HEAD"}`)
}

function assertUpToDate() {
  run("git", ["fetch", "origin", "main"])
  const local = output("git", ["rev-parse", "HEAD"])
  const remote = output("git", ["rev-parse", "origin/main"])
  if (local !== remote) throw new Error("Local main must match origin/main before release")
}

function currentVersion() {
  const versions = publishable.map((dir) => readJson(`${dir}/package.json`).version)
  const unique = new Set(versions)
  if (unique.size !== 1) throw new Error(`Publishable versions are not aligned: ${versions.join(", ")}`)
  return versions[0]
}

function packageNames() {
  return publishable.map((dir) => readJson(`${dir}/package.json`).name)
}

function ghJson(args) {
  return JSON.parse(output("gh", args))
}

async function waitForCi(sha) {
  if (forceCi) {
    console.log(`Skipping CI wait because --force-ci was passed for ${sha}`)
    return
  }

  console.log(`Waiting for green CI on ${sha}`)
  const started = Date.now()
  while (Date.now() - started < 45 * 60 * 1000) {
    const runs = ghJson([
      "run",
      "list",
      "--workflow",
      "CI",
      "--branch",
      "main",
      "--commit",
      sha,
      "--event",
      "push",
      "--limit",
      "5",
      "--json",
      "databaseId,status,conclusion,url",
    ])

    const runForSha = runs[0]
    if (!runForSha) {
      console.log("CI run not visible yet; waiting...")
    } else if (runForSha.status === "completed" && runForSha.conclusion === "success") {
      console.log(`CI green: ${runForSha.url}`)
      return
    } else if (runForSha.status === "completed") {
      throw new Error(`CI completed with ${runForSha.conclusion}: ${runForSha.url}`)
    } else {
      console.log(`CI ${runForSha.status}: ${runForSha.url}`)
    }

    await sleep(30_000)
  }

  throw new Error("Timed out waiting for CI")
}

async function triggerRelease(sha) {
  run("gh", ["workflow", "run", "release.yml", "--ref", "main", "-f", `force_ci=${forceCi ? "true" : "false"}`])
  await sleep(5_000)

  const runs = ghJson([
    "run",
    "list",
    "--workflow",
    "Release",
    "--commit",
    sha,
    "--event",
    "workflow_dispatch",
    "--limit",
    "5",
    "--json",
    "databaseId,url,status,conclusion",
  ])
  const releaseRun = runs[0]
  if (!releaseRun) throw new Error("Could not find triggered Release workflow run")

  console.log(`Release workflow: ${releaseRun.url}`)
  run("gh", ["run", "watch", String(releaseRun.databaseId), "--exit-status"])
}

async function waitForNpm(version) {
  const names = packageNames()
  const pending = new Set(names)
  const started = Date.now()

  while (pending.size > 0 && Date.now() - started < 10 * 60 * 1000) {
    for (const name of [...pending]) {
      try {
        const published = output("npm", ["view", `${name}@${version}`, "version"])
        if (published === version) {
          console.log(`Published: ${name}@${version}`)
          pending.delete(name)
        }
      } catch {
        // npm registry can lag briefly after publish.
      }
    }

    if (pending.size > 0) {
      console.log(`Waiting for npm: ${[...pending].join(", ")}`)
      await sleep(15_000)
    }
  }

  if (pending.size > 0) throw new Error(`Timed out waiting for npm: ${[...pending].join(", ")}`)
}

assertCleanTree()
assertOnMain()
assertUpToDate()
const before = currentVersion()

run("node", ["scripts/version.mjs", bump])
const version = currentVersion()
run("pnpm", ["audit:publish-manifests"])

run("git", ["add", ...publishable.map((dir) => `${dir}/package.json`)])
run("git", ["commit", "-m", `chore(release): bump packages to ${version}`])
run("git", ["push", "origin", "main"])

const sha = output("git", ["rev-parse", "HEAD"])
console.log(`Release bump committed: ${before} → ${version} (${sha})`)

await waitForCi(sha)
await triggerRelease(sha)
await waitForNpm(version)

run("npm", ["install", "-g", `@hachej/boring-ui-cli@${version}`])
console.log(`Release complete. Local boring-ui CLI updated to ${version}.`)
