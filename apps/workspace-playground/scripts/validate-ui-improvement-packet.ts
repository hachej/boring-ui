import { resolve } from "node:path"
import { UI_REVIEW_CRITIC_PROMPT } from "../src/ui-review/critic"
import { validateUiImprovementRun } from "../src/ui-review/improvement"
import { readUiReviewWorktreeIdentity } from "./ui-review-worktree.mjs"

const arguments_ = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"))
const rootArgument = arguments_[0]
if (!rootArgument || arguments_.length !== 1) throw new Error("UI_EXECUTION_PACKET_ROOT_REQUIRED")
const root = resolve(rootArgument)
const identity = await readUiReviewWorktreeIdentity()
await validateUiImprovementRun({
  root,
  currentRevision: identity.revision,
  currentTreeHash: identity.treeHash,
  prompt: UI_REVIEW_CRITIC_PROMPT,
  rubricPath: resolve(process.cwd(), "../..", ".impeccable.md"),
})
console.log(`validated UI improvement packet: ${resolve(root, "execution-packet.json")}`)
