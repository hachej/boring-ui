"use client"

import * as React from 'react'
import {
  FileTreePane,
  type FileTreePaneParams,
  type FileTreeRootConfig,
  type WorkspaceSourceProps,
} from '@hachej/boring-workspace'
import { definePlugin } from '@hachej/boring-workspace/plugin'

const DEFAULT_ENDPOINT = '/api/v1/governance/usage-summary'

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

interface GovernanceUsageSummary {
  companyContextAccess?: 'none' | 'readonly' | 'readwrite'
}

/**
 * Creates a Files source that always exposes the personal workspace and adds
 * the governed `company_context` root when the authenticated user can access it.
 */
export function createGovernanceFilesRootsPlugin({
  id = 'governance-files-roots',
  label = 'Governed Files',
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
  workspaceRoot = {
    filesystem: 'user',
    label: 'Workspace',
    rootDir: '.',
    access: 'readwrite',
    searchPlaceholder: 'Search workspace files...',
  },
  companyContext = {},
}: CreateGovernanceFilesRootsPluginOptions = {}) {
  function useRoots(): FileTreeRootConfig[] {
    const [roots, setRoots] = React.useState<FileTreeRootConfig[]>([workspaceRoot])

    React.useEffect(() => {
      const controller = new AbortController()
      void fetchImpl(endpoint, { credentials: 'include', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Governance usage status failed (${response.status})`)
          return response.json() as Promise<GovernanceUsageSummary>
        })
        .then((summary) => {
          if (controller.signal.aborted) return
          const access = summary.companyContextAccess ?? 'none'
          if (access === 'none') return
          setRoots([
            workspaceRoot,
            {
              filesystem: 'company_context',
              label: companyContext.label ?? 'Company context',
              rootDir: companyContext.rootDir ?? '/',
              access,
              searchPlaceholder: companyContext.searchPlaceholder ?? 'Search company context files...',
            },
          ])
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) console.error('Failed to resolve company_context file root access', error)
        })
      return () => controller.abort()
    }, [])

    return roots
  }

  function GovernanceFilesRootsSource(props: WorkspaceSourceProps<FileTreePaneParams>) {
    const roots = useRoots()
    return <FileTreePane {...props} params={{ ...props.params, roots }} />
  }

  return definePlugin({
    id,
    label,
    workspaceSources: [{
      id: 'files',
      label: 'Files',
      source: 'app',
      component: GovernanceFilesRootsSource,
    }],
  })
}
