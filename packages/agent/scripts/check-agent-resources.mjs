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
  "handoff",
  "owner-gate",
  "plan",
  "present-pr",
  "skill-management",
  "show-me",
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

const showMeRoot = resolve(repoRoot, ".agents/skill-references/show-me/humanlayer-show-me")
const showMeSource = readFileSync(resolve(showMeRoot, "SOURCE.md"), "utf8")
const showMeHashes = [
  [resolve(showMeRoot, "SKILL.md"), /- Upstream `SKILL\.md` SHA-256: `([0-9a-f]{64})`/],
  [resolve(showMeRoot, "LICENSE.txt"), /- `LICENSE\.txt` SHA-256: `([0-9a-f]{64})`/],
  [resolve(activeRoot, "show-me/SKILL.md"), /- Active `SKILL\.md` SHA-256: `([0-9a-f]{64})`/],
]
for (const [file, pattern] of showMeHashes) {
  const expectedHash = showMeSource.match(pattern)?.[1]
  if (!expectedHash) {
    fail(`show-me SOURCE.md must declare the ${basename(file)} SHA-256 for ${relative(repoRoot, file)}`)
  } else {
    checkHash(file, expectedHash)
  }
}
if (!/- Pinned commit: `[0-9a-f]{40}`/.test(showMeSource)) {
  fail("show-me SOURCE.md must declare a pinned 40-character commit")
}
const showMeSkill = resolve(activeRoot, "show-me/SKILL.md")
const showMeSkillSource = readFileSync(showMeSkill, "utf8")
if (!/^disable-model-invocation: true$/m.test(showMeSkillSource)) {
  fail("show-me must remain explicit-only with disable-model-invocation: true")
}
const showMeReferencePointer = "../../skill-references/show-me/humanlayer-show-me/"
if (!showMeSkillSource.includes(showMeReferencePointer)) {
  fail(`show-me SKILL.md must reference ${showMeReferencePointer}`)
} else if (!existsSync(resolve(dirname(showMeSkill), showMeReferencePointer))) {
  fail(`missing show-me reference target ${showMeReferencePointer}`)
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
