#!/usr/bin/env node
/**
 * Set a unique CI prerelease version across all publishable packages.
 *
 * This is intentionally non-committing: CI mutates package.json files in the
 * checkout before packing so every successful main build can publish a unique
 * npm version without moving the stable release version in git.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const dryRun = process.argv.includes("--dry-run")

const PUBLISHABLE = [
  "packages/core",
  "packages/plugin-cli",
  "packages/workspace",
  "packages/agent",
  "packages/ui",
  "packages/cli",
  "plugins/deck",
  "plugins/ask-user",
  "plugins/data-explorer",
  "plugins/data-catalog",
  "plugins/generated-pane",
  "plugins/data-bridge",
  "plugins/bi-dashboard",
  "packages/boring-bash",
  "plugins/boring-governance",
]

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

function sanitizeIdentifier(value, fallback) {
  const cleaned = String(value ?? "")
    .replace(/[^0-9A-Za-z-]/g, "")
    .replace(/^-+|-+$/g, "")
  return cleaned || fallback
}

function nextCiVersion(current) {
  const base = String(current).split("-")[0]
  const parts = base.split(".").map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error(`Invalid semver version: ${current}`)
  }

  const [major, minor, patch] = parts
  const run = sanitizeIdentifier(process.env.GITHUB_RUN_NUMBER, "local")
  const attempt = sanitizeIdentifier(process.env.GITHUB_RUN_ATTEMPT, "1")
  const sha = sanitizeIdentifier(process.env.GITHUB_SHA, "dev").slice(0, 12)
  return `${major}.${minor}.${patch + 1}-ci.${run}.${attempt}.${sha}`
}

const first = readJson(resolve(root, PUBLISHABLE[0], "package.json"))
const next = nextCiVersion(first.version)

console.log(`CI package version: ${first.version} → ${next}`)

for (const pkg of PUBLISHABLE) {
  const path = resolve(root, pkg, "package.json")
  const json = readJson(path)
  json.version = next
  console.log(`  ${json.name}@${next}`)
  if (!dryRun) writeJson(path, json)
}

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`, { flag: "a" })
}
