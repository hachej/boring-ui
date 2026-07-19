import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, readFile, readlink } from "node:fs/promises"
import { resolve } from "node:path"

export async function readUiReviewWorktreeIdentity(cwd = process.cwd()) {
  const root = await git(["rev-parse", "--show-toplevel"], cwd)
  const revision = await git(["rev-parse", "HEAD"], root)
  if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error("UI_REVIEW_CANDIDATE_REVISION_INVALID")
  const trackedDiff = await gitBuffer(["diff", "--binary", "HEAD", "--"], root)
  const untrackedOutput = await gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"], root)
  const untracked = untrackedOutput.toString("utf8").split("\0").filter(Boolean).sort()
  const hash = createHash("sha256")
  hash.update("ui-review-worktree-v1\0")
  hash.update(revision)
  hash.update("\0tracked\0")
  hash.update(trackedDiff)
  for (const relativePath of untracked) {
    const absolutePath = resolve(root, relativePath)
    const metadata = await lstat(absolutePath)
    hash.update("\0untracked\0")
    hash.update(relativePath)
    hash.update("\0")
    if (metadata.isSymbolicLink()) {
      hash.update("symlink\0")
      hash.update(await readlink(absolutePath))
    } else if (metadata.isFile()) {
      hash.update("file\0")
      hash.update(await readFile(absolutePath))
    } else {
      throw new Error(`UI_REVIEW_WORKTREE_ENTRY_INVALID:${relativePath}`)
    }
  }
  return { root, revision, treeHash: hash.digest("hex") }
}

function git(argv, cwd) {
  return gitBuffer(argv, cwd).then((output) => output.toString("utf8").trim())
}

function gitBuffer(argv, cwd) {
  return new Promise((resolveOutput, reject) => {
    execFile("git", argv, { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`UI_REVIEW_GIT_FAILED:${argv.join(" ")}:${error.message}`))
      else resolveOutput(stdout)
    })
  })
}
