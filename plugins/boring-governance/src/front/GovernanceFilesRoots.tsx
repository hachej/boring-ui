import type { FileTreeRootConfig } from '@hachej/boring-workspace'
import { definePlugin } from '@hachej/boring-workspace/plugin'

export interface GovernanceCompanyContextRootOptions {
  label?: string
  rootDir?: string
  searchPlaceholder?: string
}

export interface CreateGovernanceFilesRootsPluginOptions {
  id?: string
  label?: string
  endpoint?: string
  fetchImpl?: typeof fetch
  workspaceRoot?: FileTreeRootConfig
  companyContext?: GovernanceCompanyContextRootOptions
}

/**
 * @deprecated Filesystem roots are discovered from the server-owned
 * `GET /api/v1/filesystems` catalog. Retained as a no-op compatibility shim.
 */
export function createGovernanceFilesRootsPlugin({
  id = 'governance-files-roots',
  label = 'Governed Files',
}: CreateGovernanceFilesRootsPluginOptions = {}) {
  return definePlugin({ id, label })
}
