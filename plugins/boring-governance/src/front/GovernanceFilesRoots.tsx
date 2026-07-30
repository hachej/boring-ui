"use client"

import * as React from 'react'
import {
  FileTreeRootsProvider,
  type FileTreeRootConfig,
  type PluginProviderProps,
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

function stableHeadersKey(headers: Record<string, string> | undefined): string {
  return JSON.stringify(Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right)))
}

/**
 * Creates a provider-only plugin that supplies governed roots to Workspace's
 * built-in Files source. It does not register or replace a workspace source.
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
  const workspaceRoots: readonly FileTreeRootConfig[] = [workspaceRoot]

  function GovernanceFilesRootsProvider({
    authHeaders,
    children,
  }: PluginProviderProps) {
    const headersKey = stableHeadersKey(authHeaders)
    const requestKey = `${endpoint}\n${headersKey}`
    const requestHeaders = React.useMemo<Record<string, string>>(
      () => Object.fromEntries(JSON.parse(headersKey) as Array<[string, string]>),
      [headersKey],
    )
    const [resolved, setResolved] = React.useState<{
      requestKey: string
      roots: readonly FileTreeRootConfig[]
    }>(() => ({ requestKey, roots: workspaceRoots }))

    React.useEffect(() => {
      const controller = new AbortController()
      let stale = false
      setResolved({ requestKey, roots: workspaceRoots })

      void fetchImpl(endpoint, {
        credentials: 'include',
        headers: requestHeaders,
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Governance usage status failed (${response.status})`)
          return response.json() as Promise<GovernanceUsageSummary>
        })
        .then((summary) => {
          if (stale || controller.signal.aborted) return
          const access = summary.companyContextAccess ?? 'none'
          if (access !== 'readonly' && access !== 'readwrite') return
          setResolved({
            requestKey,
            roots: [
              workspaceRoot,
              {
                filesystem: 'company_context',
                label: companyContext.label ?? 'Company context',
                rootDir: companyContext.rootDir ?? '/',
                access,
                searchPlaceholder: companyContext.searchPlaceholder ?? 'Search company context files...',
              },
            ],
          })
        })
        .catch((error: unknown) => {
          if (stale || controller.signal.aborted) return
          console.error('Failed to resolve company_context file root access', error)
          setResolved({ requestKey, roots: workspaceRoots })
        })

      return () => {
        stale = true
        controller.abort()
      }
    }, [headersKey, requestHeaders, requestKey])

    const roots = resolved.requestKey === requestKey ? resolved.roots : workspaceRoots
    return <FileTreeRootsProvider roots={roots}>{children}</FileTreeRootsProvider>
  }

  return definePlugin({
    id,
    label,
    providers: [{
      id: 'governance-files-roots',
      component: GovernanceFilesRootsProvider,
    }],
  })
}
