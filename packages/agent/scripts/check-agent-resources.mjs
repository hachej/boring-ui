#!/usr/bin/env node
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadSkillsFromDir } from "@mariozechner/pi-coding-agent"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const activeRoot = resolve(repoRoot, ".agents/skills")
const expectedSkills = [
  "ask-boring",
  "autoresearch",
  "boring-app-setup",
  "boring-plugin-build",
  "exec",
  "feedback",
  "fresh-eyes",
  "grill-for-unknowns",
  "plan",
  "skill-management",
  "teach",
  "triage",
  "ui",
].sort()

function fail(message) {
  console.error(`[agent-resources] FAIL ${message}`)
  process.exitCode = 1
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function checkHash(file, expected) {
  if (!existsSync(file)) {
    fail(`missing hashed reference ${relative(repoRoot, file)}`)
    return
  }
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex")
  if (actual !== expected) {
    fail(`${relative(repoRoot, file)} SHA-256 is ${actual}, expected ${expected}`)
  }
}

function checkIndexHashes(indexPath) {
  const indexFile = resolve(repoRoot, indexPath)
  const sections = readFileSync(indexFile, "utf8").split(/^## /m).slice(1)
  for (const section of sections) {
    const readPath = section.match(/- \*\*Read:\*\* `([^`]+)`/)?.[1]
    const expectedHash = section.match(/- \*\*Exact(?: SKILL\.md)? SHA-256:\*\* `([0-9a-f]{64})`/)?.[1]
    if (readPath && expectedHash) {
      checkHash(resolve(dirname(indexFile), readPath), expectedHash)
    }
  }
}

const result = loadSkillsFromDir({ dir: activeRoot, source: "project" })
for (const diagnostic of result.diagnostics) {
  fail(`${diagnostic.path ?? activeRoot}: ${diagnostic.message}`)
}

const discovered = result.skills.map((skill) => skill.name).sort()
if (JSON.stringify(discovered) !== JSON.stringify(expectedSkills)) {
  fail(`expected active skills ${JSON.stringify(expectedSkills)}, received ${JSON.stringify(discovered)}`)
}

for (const skillName of expectedSkills) {
  const skillRoot = resolve(activeRoot, skillName)
  const skillFile = resolve(skillRoot, "SKILL.md")
  if (!existsSync(skillFile)) {
    fail(`missing ${relative(repoRoot, skillFile)}`)
    continue
  }
  for (const file of walk(skillRoot)) {
    if (file !== skillFile && basename(file) === "SKILL.md") {
      fail(`nested discoverable skill must move to .agents/skill-references: ${relative(repoRoot, file)}`)
    }
  }
}

const pointers = [
  ["exec", "../../skill-references/exec/index.md"],
  ["plan", "../../skill-references/plan/index.md"],
]
for (const [skillName, pointer] of pointers) {
  const skillFile = resolve(activeRoot, skillName, "SKILL.md")
  const target = resolve(dirname(skillFile), pointer)
  if (!readFileSync(skillFile, "utf8").includes(pointer)) {
    fail(`${relative(repoRoot, skillFile)} must reference ${pointer}`)
  }
  if (!existsSync(target)) {
    fail(`missing reference target ${relative(repoRoot, target)}`)
  }
}

const gitignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8")
const allowlistedSkills = [...gitignore.matchAll(/^!\/\.agents\/skills\/([^/*]+)\/$/gm)]
  .map((match) => match[1])
  .sort()
if (JSON.stringify(allowlistedSkills) !== JSON.stringify(expectedSkills)) {
  fail(`.gitignore skill allowlist ${JSON.stringify(allowlistedSkills)} does not match ${JSON.stringify(expectedSkills)}`)
}
for (const skillName of expectedSkills) {
  if (!gitignore.includes(`!/.agents/skills/${skillName}/**`)) {
    fail(`.gitignore must include the contents of active skill ${skillName}`)
  }
}

checkIndexHashes(".agents/skill-references/exec/index.md")
checkIndexHashes(".agents/skill-references/plan/index.md")
const skillManagementRoot = resolve(
  repoRoot,
  ".agents/skill-references/skill-management/matt-pocock-writing-great-skills",
)
const skillManagementSource = readFileSync(resolve(skillManagementRoot, "SOURCE.md"), "utf8")
const skillManagementHashes = [
  ["SKILL.md", /- `SKILL\.md` SHA-256: `([0-9a-f]{64})`/],
  ["GLOSSARY.md", /- `GLOSSARY\.md` SHA-256: `([0-9a-f]{64})`/],
]
for (const [fileName, pattern] of skillManagementHashes) {
  const expectedHash = skillManagementSource.match(pattern)?.[1]
  if (!expectedHash) {
    fail(`skill-management SOURCE.md must declare the upstream ${fileName} SHA-256`)
  } else {
    checkHash(resolve(skillManagementRoot, fileName), expectedHash)
  }
}

for (const path of [".agents/skill-references", ".agents/skill-library"]) {
  const root = resolve(repoRoot, path)
  if (!existsSync(root)) {
    fail(`missing ${path}`)
  } else if (!relative(activeRoot, root).startsWith("..")) {
    fail(`${path} must remain outside the active .agents/skills discovery root`)
  }
}
if (!existsSync(resolve(repoRoot, ".agents/skill-library/README.md"))) {
  fail("missing archived .agents/skill-library/README.md")
}

if (!process.exitCode) {
  console.log(`[agent-resources] PASS ${discovered.length} active skills; layout, allowlist, pointers, and hashes valid`)
}
