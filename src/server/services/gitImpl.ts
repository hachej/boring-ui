/**
 * Git service implementation using simple-git.
 * Replaces Python subprocess-based git operations.
 */
import simpleGit, { type SimpleGit } from 'simple-git'
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
    throw new Error(`Invalid remote name: ${name}`)
  }
  if (!name || name.length > 255) {
    throw new Error(`Remote name must be 1-255 characters`)
  }
}

function validateCloneUrl(url: string): void {
  if (!ALLOWED_URL_SCHEMES.test(url)) {
    throw new Error(
      `Unsupported URL scheme. Only https:// and git@ are allowed.`,
    )
  }
}

export interface GitServiceImpl {
  isGitRepo(): Promise<boolean>
  getStatus(): Promise<GitStatusResult>
  getDiff(path?: string): Promise<GitDiffResult>
  getShow(path: string): Promise<GitShowResult>
  currentBranch(): Promise<{ branch: string }>
  listBranches(): Promise<{ branches: string[]; current: string | null }>
  listRemotes(): Promise<{ remotes: { name: string; url: string }[] }>
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

  return {
    async isGitRepo(): Promise<boolean> {
      try {
        return await git.checkIsRepo()
      } catch {
        return false
      }
    },

    async getStatus(): Promise<GitStatusResult> {
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
      try {
        const diff = path ? await git.diff([path]) : await git.diff()
        return { diff, path: path || '' }
      } catch (err: any) {
        return { diff: '', path: path || '' }
      }
    },

    async getShow(path: string): Promise<GitShowResult> {
      try {
        const content = await git.show([`HEAD:${path}`])
        return { content, path }
      } catch (err: any) {
        return { content: null, path, error: err.message }
      }
    },

    async currentBranch(): Promise<{ branch: string }> {
      try {
        const branch = await git.branchLocal()
        return { branch: branch.current }
      } catch {
        return { branch: '' }
      }
    },

    async listBranches(): Promise<{ branches: string[]; current: string | null }> {
      try {
        const result = await git.branchLocal()
        return { branches: result.all, current: result.current || null }
      } catch {
        return { branches: [], current: null }
      }
    },

    async listRemotes(): Promise<{ remotes: { name: string; url: string }[] }> {
      try {
        const remotes = await git.getRemotes(true)
        return {
          remotes: remotes.map((r) => ({
            name: r.name,
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
      const options: Record<string, string> = {}
      if (authorName && authorEmail) {
        options['--author'] = `${authorName} <${authorEmail}>`
      }
      const result = await git.commit(message, undefined, options)
      return { oid: result.commit }
    },

    async push(
      remote = 'origin',
      branch?: string,
      credentials?: GitCredentials,
    ): Promise<{ pushed: boolean }> {
      validateRemoteName(remote)
      if (credentials) {
        // Inject credentials via GIT_ASKPASS or credential helper
        const env = {
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo',
        }
        // For now, use the git instance directly
        // Credential injection via remote URL rewriting is handled at a higher level
      }
      const args = branch ? [remote, branch] : [remote]
      await git.push(args)
      return { pushed: true }
    },

    async pull(
      remote = 'origin',
      branch?: string,
      credentials?: GitCredentials,
    ): Promise<{ pulled: boolean }> {
      validateRemoteName(remote)
      const args: string[] = branch ? [remote, branch] : [remote]
      await git.pull(...args as [string, string])
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
      if (checkout) {
        await git.checkoutLocalBranch(name)
      } else {
        await git.branch([name])
      }
      return { created: true, branch: name, checked_out: checkout }
    },

    async checkoutBranch(name: string): Promise<{ checked_out: boolean; branch: string }> {
      await git.checkout(name)
      return { checked_out: true, branch: name }
    },

    async mergeBranch(
      source: string,
      message?: string,
    ): Promise<{ merged: boolean; source: string }> {
      const options = message ? ['--no-ff', '-m', message] : []
      await git.merge([source, ...options])
      return { merged: true, source }
    },

    async addRemote(name: string, url: string): Promise<{ added: boolean }> {
      validateRemoteName(name)
      validateCloneUrl(url)
      await git.addRemote(name, url)
      return { added: true }
    },
  }
}
