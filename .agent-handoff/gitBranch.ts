import { __gitTestUtils } from './gitFileUrl'

export interface GitBranchResult {
  enabled: boolean
  reason?: string
  /** Branch name, or the short commit sha when HEAD is detached. */
  branch?: string
  detached?: boolean
}

function disabled(reason: string): GitBranchResult {
  return { enabled: false, reason }
}

/**
 * Resolve the checked-out branch for a workspace root.
 *
 * Lives in the server adapter layer (not in routes/) because it shells out to
 * git; routes must stay free of node:child_process/node:fs per the agent
 * invariants. Reuses the same `runGit` seam as resolveGitFileUrl so tests can
 * stub git without spawning a process, and so we add no git dependency.
 *
 * Returns a disabled result for the expected "not a repo / no commits yet"
 * cases so non-Git workspaces render nothing rather than an error.
 */
export async function resolveGitBranch(workspaceRoot: string): Promise<GitBranchResult> {
  let repoRoot: string
  try {
    repoRoot = await __gitTestUtils.runGit(['rev-parse', '--show-toplevel'], workspaceRoot)
  } catch {
    return disabled('Workspace is not inside a Git repository.')
  }

  try {
    const branch = await __gitTestUtils.runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot)
    if (branch) return { enabled: true, branch }
  } catch {
    // Detached HEAD: symbolic-ref exits non-zero. Fall through to the sha.
  }

  try {
    const commitSha = await __gitTestUtils.runGit(['rev-parse', '--short', 'HEAD'], repoRoot)
    if (commitSha) return { enabled: true, branch: commitSha, detached: true }
  } catch {
    // Unborn branch (fresh `git init`, no commits): nothing meaningful to show.
  }

  return disabled('Git HEAD is not resolvable yet.')
}
