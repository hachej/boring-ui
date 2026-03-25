/**
 * Git service — transport-independent business logic for git operations.
 * Mirrors Python's modules/git/service.py.
 */
import type {
  GitStatusResult,
  GitDiffResult,
  GitShowResult,
  GitCredentials,
} from '../../shared/types.js'

export interface GitServiceDeps {
  workspaceRoot: string
}

export interface GitService {
  isGitRepo(): Promise<boolean>
  getStatus(): Promise<GitStatusResult>
  getDiff(path: string): Promise<GitDiffResult>
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
  push(
    remote?: string,
    branch?: string,
    credentials?: GitCredentials,
  ): Promise<{ pushed: boolean }>
  pull(
    remote?: string,
    branch?: string,
    credentials?: GitCredentials,
  ): Promise<{ pulled: boolean }>
  cloneRepo(
    url: string,
    branch?: string,
    credentials?: GitCredentials,
  ): Promise<{ cloned: boolean }>
  createBranch(
    name: string,
    checkout?: boolean,
  ): Promise<{ created: boolean; branch: string; checked_out: boolean }>
  checkoutBranch(
    name: string,
  ): Promise<{ checked_out: boolean; branch: string }>
  mergeBranch(
    source: string,
    message?: string,
  ): Promise<{ merged: boolean; source: string }>
  addRemote(name: string, url: string): Promise<{ added: boolean }>
}

export function createGitService(_deps: GitServiceDeps): GitService {
  throw new Error('Not implemented — see bd-qvv02 (Phase 2: Git service)')
}
