import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)
const repoRoot = resolve(import.meta.dirname, "../../..")
process.chdir(repoRoot)
const { createBeadsTaskSource, createWorkspaceBeadsOperations } = await import("../dist/server/index.js")

const AUTHORITATIVE_FILES = [
  "issues.jsonl",
  "beads.db",
  "beads.db-wal",
  "beads.db-shm",
  "metadata.json",
  "config.yaml",
]
const ROOT_BEAD_ID = "wt-391-forward-gh-1072-factory-agents-beads-020e"
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const recursivelySorted = (value) => Array.isArray(value)
  ? value.map(recursivelySorted)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, recursivelySorted(value[key])]))
    : value

async function authoritativeFiles() {
  const result = {}
  for (const name of AUTHORITATIVE_FILES) {
    try {
      const bytes = await readFile(`.beads/${name}`)
      result[name] = { size: bytes.length, sha256: sha256(bytes) }
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause
      result[name] = null
    }
  }
  return result
}

async function transientLocks() {
  const result = {}
  const names = (await readdir(".beads")).filter((name) => name.includes("lock")).sort()
  for (const name of names) {
    const info = await stat(`.beads/${name}`)
    result[name] = { size: info.size, mtimeMs: info.mtimeMs }
  }
  return result
}

async function brJson(args) {
  const { stdout } = await exec("br", args, { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 })
  return JSON.parse(stdout)
}

async function semanticSnapshot() {
  const list = await brJson(["list", "--all", "--json", "--no-auto-flush", "--no-auto-import", "--no-db"])
  list.issues.sort((left, right) => left.id.localeCompare(right.id))
  const ids = list.issues.map((issue) => issue.id)
  const shows = new Array(ids.length)
  let next = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const index = next++
      if (index >= ids.length) return
      shows[index] = await brJson(["show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--", ids[index]])
    }
  }))
  const canonical = JSON.stringify(recursivelySorted({ list, shows }))
  return { count: ids.length, bytes: Buffer.byteLength(canonical), sha256: sha256(canonical) }
}

const workspaceAt = (root) => ({
  root,
  runtimeContext: { runtimeCwd: root },
  async stat(relPath) {
    const info = await stat(resolve(root, relPath))
    return { kind: info.isDirectory() ? "dir" : "file" }
  },
})
const before = {
  files: await authoritativeFiles(),
  locks: await transientLocks(),
  semantic: await semanticSnapshot(),
}
const beadsOperations = createWorkspaceBeadsOperations(workspaceAt(repoRoot))
const source = createBeadsTaskSource({ operations: beadsOperations })
const cards = await source.listTasks({})
const detail = await source.getTask({}, { taskId: ROOT_BEAD_ID })
let notFound
try {
  await source.getTask({}, { taskId: "does-not-exist" })
} catch (cause) {
  notFound = { code: cause.code, status: cause.status, retryable: cause.retryable }
}
const uninitializedRoot = resolve(repoRoot, "plugins/tasks/test-fixtures/uninitialized-workspace")
const uninitializedBefore = await readdir(resolve(uninitializedRoot, ".beads"))
let uninitializedError
const uninitializedOperations = createWorkspaceBeadsOperations(workspaceAt(uninitializedRoot))
try {
  const uninitializedSource = createBeadsTaskSource({ operations: uninitializedOperations })
  await uninitializedSource.listTasks({})
} catch (cause) {
  uninitializedError = { code: cause.code, status: cause.status, retryable: cause.retryable }
}
await uninitializedOperations.dispose?.()
await beadsOperations.dispose?.()
const uninitializedAfter = await readdir(resolve(uninitializedRoot, ".beads"))
const after = {
  semantic: await semanticSnapshot(),
  files: await authoritativeFiles(),
  locks: await transientLocks(),
}
const filesUnchanged = AUTHORITATIVE_FILES.every((name) => JSON.stringify(before.files[name]) === JSON.stringify(after.files[name]))
const semanticUnchanged = before.semantic.sha256 === after.semantic.sha256
const proof = {
  version: 1,
  platform: process.platform,
  protocol: {
    version: ["br", "--version"],
    list: ["br", "list", "--all", "--json", "--no-auto-flush", "--no-auto-import", "--no-db"],
    show: ["br", "show", "--json", "--no-auto-flush", "--no-auto-import", "--no-db", "--", "<validated-id>"],
  },
  before,
  after,
  observed: {
    cardCount: cards.length,
    detailId: detail.task.id,
    notFound,
    uninitializedStore: {
      before: uninitializedBefore,
      after: uninitializedAfter,
      error: uninitializedError,
      unchanged: JSON.stringify(uninitializedBefore) === JSON.stringify(uninitializedAfter),
    },
  },
  filesUnchanged,
  semanticUnchanged,
}
const output = resolve(repoRoot, process.env.BEADS_PROOF_OUTPUT || "docs/issues/1072/proof/beads-readonly.json")
await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`)
console.log(JSON.stringify({ output, filesUnchanged, semanticUnchanged, semantic: after.semantic }, null, 2))
if (!filesUnchanged || !semanticUnchanged || !proof.observed.uninitializedStore.unchanged) process.exitCode = 1
