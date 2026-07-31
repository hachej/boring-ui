#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

export function validateReleaseResumeState({
  version,
  parentVersion,
  commitSubject,
  changedFiles,
  allowedFiles,
  tagsAtHead,
}) {
  const errors = []
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    errors.push(`current package version is invalid: ${version}`)
  }
  if (parentVersion === version) errors.push("current commit does not change the root package version")
  if (commitSubject !== `chore(release): bump packages to ${version}`) {
    errors.push(`current commit is not the expected release bump for ${version}`)
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    errors.push("current release bump commit has no changed files")
  } else {
    const allowed = new Set(allowedFiles)
    for (const file of changedFiles) {
      if (!allowed.has(file)) errors.push(`release bump commit changed unexpected file: ${file}`)
    }
  }
  if (tagsAtHead.length > 0) errors.push(`current release bump is already tagged: ${tagsAtHead.join(", ")}`)
  if (errors.length > 0) throw new Error(errors.join("\n"))
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

function packageVersion(contents) {
  return JSON.parse(contents).version
}

function main() {
  const allowedFiles = process.argv.slice(2)
  if (allowedFiles.length === 0) throw new Error("validate-release-resume requires allowed release file paths")
  const version = packageVersion(readFileSync("package.json", "utf8"))
  const parentVersion = packageVersion(git("show", "HEAD^:package.json"))
  const commitSubject = git("log", "-1", "--pretty=%s")
  const changedFiles = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").filter(Boolean)
  const tagsAtHead = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean)
  validateReleaseResumeState({
    version,
    parentVersion,
    commitSubject,
    changedFiles,
    allowedFiles,
    tagsAtHead,
  })
  console.log(`Release resume state is valid for untagged v${version} bump at ${git("rev-parse", "HEAD")}.`)
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
