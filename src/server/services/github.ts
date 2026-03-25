/**
 * GitHub service — transport-independent GitHub App/OAuth logic.
 * Mirrors Python's modules/github_auth/service.py.
 */

export interface GitHubServiceDeps {
  appId?: string
  clientId?: string
  clientSecret?: string
  privateKey?: string
}

export interface GitHubService {
  getInstallationToken(installationId: string): Promise<string>
  getOAuthUrl(state: string): string
  exchangeCode(code: string): Promise<{ access_token: string }>
}

export function createGitHubService(_deps: GitHubServiceDeps): GitHubService {
  throw new Error('Not implemented — see Phase 5/6 GitHub integration beads')
}
