/**
 * Git service implementation using simple-git.
 * Replaces Python subprocess-based git operations.
 */
import simpleGit, { type SimpleGit } from 'simple-git'
import { realpathSync } from 'node:fs'
import type {
  GitStatusResult,
  GitDiffResult,
  GitShowResult,
  GitCredentials,
} from '../../shared/types.js'

// Security: reject names/URLs with flag injection
const FLAG_INJECTION_RE = /^-/
const ALLOWED_URL_SCHEMES = /^(https?:\/\/|git@)/i

function validateRemoteName(name: string): void {
  if (FLAG_INJECTION_RE.test(name)) {
    throw Object.assign(new Error(`Invalid remote name: ${name}`), { statusCode: 400 })
  }
  if (!name || name.length > 255) {
    throw Object.assign(new Error('Remote name must be 1-255 characters'), { statusCode: 400 })
  }
}

function validateCloneUrl(url: string): void {
  if (!ALLOWED_URL_SCHEMES.test(url)) {
    throw Object.assign(new Error(
      `Unsupported URL scheme. Only https:// and git@ are allowed.`,
    ), { statusCode: 400 })
  }
}

export interface GitServiceImpl {
  isGitRepo(): Promise<boolean>
  getStatus(): Promise<GitStatusResult>
  getDiff(path?: string): Promise<GitDiffResult>
  getShow(path: string): Promise<GitShowResult>
  currentBranch(): Promise<{ branch: string }>
  listBranches(): Promise<{ branches: string[]; current: string | null }>
  listRemotes(): Promise<{ remotes: { name: string; remote: string; url: string }[] }>
  initRepo(): Promise<{ initialized: boolean }>
  addFiles(paths?: string[]): Promise<{ staged: boolean }>
  commit(
    message: string,
    authorName?: string,
    authorEmail?: string,
  ): Promise<{ oid: string }>
  push(remote?: string, branch?: string, credentials?: GitCredentials): Promise<{ pushed: boolean }>
  pull(remote?: string, branch?: string, credentials?: GitCredentials): Promise<{ pulled: boolean }>
  cloneRepo(url: string, branch?: string, credentials?: GitCredentials): Promise<{ cloned: boolean }>
  createBranch(name: string, checkout?: boolean): Promise<{ created: boolean; branch: string; checked_out: boolean }>
  checkoutBranch(name: string): Promise<{ checked_out: boolean; branch: string }>
  mergeBranch(source: string, message?: string): Promise<{ merged: boolean; source: string }>
  addRemote(name: string, url: string): Promise<{ added: boolean }>
}

export function createGitServiceImpl(workspaceRoot: string): GitServiceImpl {
  const git: SimpleGit = simpleGit(workspaceRoot)
  const canonicalWorkspaceRoot = realpathSync(workspaceRoot)

  async function resolveWorkspaceRepoRoot(): Promise<string | null> {
    try {
      return realpathSync((await git.raw(['rev-parse', '--show-toplevel'])).trim())
    } catch {
      return null
    }
  }

  async function isWorkspaceRepo(): Promise<boolean> {
    return (await resolveWorkspaceRepoRoot()) === canonicalWorkspaceRoot
  }

  async function requireWorkspaceRepo(): Promise<void> {
    if (!await isWorkspaceRepo()) {
      throw Object.assign(new Error('git repository not initialized in workspace'), { statusCode: 400 })
    }
  }

  return {
    async isGitRepo(): Promise<boolean> {
      try {
        return await isWorkspaceRepo()
      } catch {
        return false
      }
    },

    async getStatus(): Promise<GitStatusResult> {
      if (!await isWorkspaceRepo()) {
        return { is_repo: false, available: false, files: [] }
      }
      try {
        const status = await git.status()
        return {
          is_repo: true,
          available: true,
          files: [
            ...status.modified.map((p) => ({ path: p, status: 'modified' })),
            ...status.not_added.map((p) => ({ path: p, status: 'untracked' })),
            ...status.staged.map((p) => ({ path: p, status: 'staged' })),
            ...status.deleted.map((p) => ({ path: p, status: 'deleted' })),
            ...status.renamed.map((r) => ({ path: r.to, status: 'renamed' })),
          ],
        }
      } catch {
        return { is_repo: false, available: false, files: [] }
      }
    },

    async getDiff(path?: string): Promise<GitDiffResult> {
      if (!await isWorkspaceRepo()) {
        return { diff: '', path: path || '' }
      }
      try {
        const diff = path ? await git.diff([path]) : await git.diff()
        return { diff, path: path || '' }
      } catch (err: any) {
        return { diff: '', path: path || '' }
      }
    },

    async getShow(path: string): Promise<GitShowResult> {
      if (!await isWorkspaceRepo()) {
        return { content: null, path, error: 'Not in HEAD' }
      }
      try {
        const content = await git.show([`HEAD:${path}`])
        return { content, path }
      } catch (err: any) {
        return { content: null, path, error: err.message }
      }
    },

    async currentBranch(): Promise<{ branch: string }> {
      if (!await isWorkspaceRepo()) {
        return { branch: '' }
      }
      try {
        const branch = await git.branchLocal()
        return { branch: branch.current }
      } catch {
        return { branch: '' }
      }
    },

    async listBranches(): Promise<{ branches: string[]; current: string | null }> {
      if (!await isWorkspaceRepo()) {
        return { branches: [], current: null }
      }
      try {
        const result = await git.branchLocal()
        return { branches: result.all, current: result.current || null }
      } catch {
        return { branches: [], current: null }
      }
    },

    async listRemotes(): Promise<{ remotes: { name: string; remote: string; url: string }[] }> {
      if (!await isWorkspaceRepo()) {
        return { remotes: [] }
      }
      try {
        const remotes = await git.getRemotes(true)
        return {
          remotes: remotes.map((r) => ({
            name: r.name,
            remote: r.name,
            url: r.refs.fetch || r.refs.push || '',
          })),
        }
      } catch {
        return { remotes: [] }
      }
    },

    async initRepo(): Promise<{ initialized: boolean }> {
      await git.init()
      await git.addConfig('user.email', 'workspace@boring.dev')
      await git.addConfig('user.name', 'Workspace')
      return { initialized: true }
    },

    async addFiles(paths?: string[]): Promise<{ staged: boolean }> {
      await requireWorkspaceRepo()
      if (paths && paths.length > 0) {
        await git.add(paths)
      } else {
        await git.add('.')
      }
      return { staged: true }
    },

    async commit(
      message: string,
      authorName?: string,
      authorEmail?: string,
    ): Promise<{ oid: string }> {
      await requireWorkspaceRepo()
      const status = await git.status()
      if (status.staged.length === 0) {
        throw Object.assign(new Error('nothing to commit'), { statusCode: 400 })
      }

      const options: Record<string, string> = {}
      if (authorName && authorEmail) {
        options['--author'] = `${authorName} <${authorEmail}>`
        const authoredGit = simpleGit(workspaceRoot).env({
          GIT_AUTHOR_NAME: authorName,
          GIT_AUTHOR_EMAIL: authorEmail,
          GIT_COMMITTER_NAME: authorName,
          GIT_COMMITTER_EMAIL: authorEmail,
        })
        const result = await authoredGit.commit(message, undefined, options)
        return { oid: result.commit }
      }
      const result = await git.commit(message, undefined, options)
      return { oid: result.commit }
    },

    async push(
      remote = 'origin',
      branch?: string,
      credentials?: GitCredentials,
    ): Promise<{ pushed: boolean }> {
      await requireWorkspaceRepo()
      validateRemoteName(remote)
      // Credential injection via remote URL rewriting is handled at a higher level
      await git.push(remote, branch)
      return { pushed: true }
    },

    async pull(
      remote = 'origin',
      branch?: string,
      credentials?: GitCredentials,
    ): Promise<{ pulled: boolean }> {
      await requireWorkspaceRepo()
      validateRemoteName(remote)
      await git.pull(remote, branch)
      return { pulled: true }
    },

    async cloneRepo(
      url: string,
      branch?: string,
    ): Promise<{ cloned: boolean }> {
      validateCloneUrl(url)
      const options = branch ? ['--branch', branch] : []
      await git.clone(url, workspaceRoot, options)
      return { cloned: true }
    },

    async createBranch(
      name: string,
      checkout = true,
    ): Promise<{ created: boolean; branch: string; checked_out: boolean }> {
      await requireWorkspaceRepo()
      if (checkout) {
        await git.checkoutLocalBranch(name)
      } else {
        await git.branch([name])
      }
      return { created: true, branch: name, checked_out: checkout }
    },

    async checkoutBranch(name: string): Promise<{ checked_out: boolean; branch: string }> {
      await requireWorkspaceRepo()
      await git.checkout(name)
      return { checked_out: true, branch: name }
    },

    async mergeBranch(
      source: string,
      message?: string,
    ): Promise<{ merged: boolean; source: string }> {
      await requireWorkspaceRepo()
      const options = message ? ['--no-ff', '-m', message] : []
      await git.merge([source, ...options])
      return { merged: true, source }
    },

    async addRemote(name: string, url: string): Promise<{ added: boolean }> {
      await requireWorkspaceRepo()
      validateRemoteName(name)
      validateCloneUrl(url)
      try {
        await git.removeRemote(name)
      } catch {
        // Ignore missing remote; addRemote should behave like replace/upsert.
      }
      await git.addRemote(name, url)
      return { added: true }
    },
  }
}
