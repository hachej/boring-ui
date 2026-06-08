import { dirname, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildGitFileUrl } from '../../../../workspace/src/plugins/filesystemPlugin/front/data/gitUrl'

const execFileAsync = promisify(execFile)

// Exposed so tests can stub the git invocation without spawning a real process.
export const __gitTestUtils = {
  runGit: async (args: string[], cwd: string): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout.trim()
  },
}

export interface GitFileUrlResult {
  enabled: boolean
  reason?: string
  url?: string
}

function disabled(reason: string): GitFileUrlResult {
  return { enabled: false, reason }
}

/**
 * Resolve a host git provider URL for a workspace-relative file path.
 *
 * Lives in the server adapter layer (not in routes/) because it shells out to
 * git; routes must stay free of node:child_process/node:fs per the agent
 * invariants. Returns a disabled result for the expected "not a repo / no
 * remote / unsupported remote" cases and throws only on unexpected failures.
 */
export async function resolveGitFileUrl(
  workspaceRoot: string,
  path: string,
): Promise<GitFileUrlResult> {
  const absolutePath = `${workspaceRoot}/${path}`

  let repoRoot: string
  try {
    repoRoot = await __gitTestUtils.runGit(['rev-parse', '--show-toplevel'], dirname(absolutePath))
  } catch {
    return disabled('Workspace is not inside a Git repository.')
  }

  let remoteUrl = ''
  try {
    remoteUrl = await __gitTestUtils.runGit(['remote', 'get-url', 'origin'], repoRoot)
  } catch {
    return disabled('Git remote “origin” is not configured.')
  }

  if (!remoteUrl) return disabled('Git remote “origin” is empty.')

  let branch: string | null = null
  try {
    branch = await __gitTestUtils.runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot)
  } catch {
    branch = null
  }

  let commitSha: string | null = null
  if (!branch) {
    try {
      commitSha = await __gitTestUtils.runGit(['rev-parse', 'HEAD'], repoRoot)
    } catch {
      commitSha = null
    }
  }

  const repoRelativePath = relative(repoRoot, absolutePath).replace(/\\/g, '/')
  const url = buildGitFileUrl({ remoteUrl, repoRelativePath, branch, commitSha })
  if (!url) {
    return disabled('Only GitHub SSH/HTTPS remotes are supported right now.')
  }

  return { enabled: true, url }
}
