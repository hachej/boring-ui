#!/usr/bin/env node
import { execFileSync } from "node:child_process"

const allowed = new Set([
  "packages/core/package.json",
  "packages/plugin-cli/package.json",
  "packages/workspace/package.json",
  "packages/agent/package.json",
  "packages/ui/package.json",
  "packages/cli/package.json",
  "packages/boring-sandbox/package.json",
  "packages/boring-bash/package.json",
  "plugins/boring-governance/package.json",
  "plugins/deck/package.json",
  "plugins/ask-user/package.json",
  "plugins/diagram/package.json",
  "plugins/tasks/package.json",
  "plugins/data-explorer/package.json",
  "plugins/data-catalog/package.json",
  "plugins/generated-pane/package.json",
  "plugins/data-bridge/package.json",
  "plugins/bi-dashboard/package.json",
  "pnpm-lock.yaml",
])

const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)

const unexpected = staged.filter((path) => !allowed.has(path))
if (unexpected.length > 0) {
  console.error("Unexpected release-staged files:")
  for (const path of unexpected) console.error(`- ${path}`)
  process.exit(1)
}

console.log(staged.length === 0 ? "release staging check ok (no staged files)" : `release staging check ok (${staged.length} staged files)`)
