import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { UiReviewManifest } from "../src/core/contracts"
import { validateUiImprovementRun } from "../src/core/improvement"
import { getUiReviewSpec } from "../src/registry"
import { readUiReviewWorktreeIdentity } from "./ui-review-worktree.mjs"

const arguments_ = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"))
const rootArgument = arguments_[0]
if (!rootArgument || arguments_.length !== 1) throw new Error("UI_EXECUTION_PACKET_ROOT_REQUIRED")
const repoRoot = resolve(import.meta.dirname, "../../..")
const root = resolve(repoRoot, rootArgument)
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as UiReviewManifest
const spec = getUiReviewSpec(manifest.scenarioId)
const identity = await readUiReviewWorktreeIdentity(repoRoot)
await validateUiImprovementRun({
  root,
  currentRevision: identity.revision,
  currentTreeHash: identity.treeHash,
  prompt: spec.criticPrompt,
  rubricPath: resolve(repoRoot, spec.criticContextPaths[0]!),
  spec,
})
console.log(`validated UI improvement packet: ${resolve(root, "execution-packet.json")}`)
