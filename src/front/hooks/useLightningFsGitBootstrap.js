import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { queryKeys } from '../providers/data'
import { useOptionalDataProvider } from '../providers/data/DataContext'
import { routes } from '../utils/routes'

const LOCAL_GIT_METADATA = new Set(['.git'])

export function normalizeRepoUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('git@github.com:')) {
    return `https://github.com/${raw.slice('git@github.com:'.length).replace(/\.git$/i, '')}`.toLowerCase()
  }
  return raw.replace(/\.git$/i, '').replace(/\/+$/g, '').toLowerCase()
}

const buildProviderUnavailableState = ({ installationConnected = false, repoUrl = '' } = {}) => {
  if (!installationConnected || !normalizeRepoUrl(repoUrl)) {
    return null
  }
  return {
    state: 'provider-unavailable',
    syncReady: false,
    needsBootstrap: false,
    reason: 'provider',
    message: 'Open the workspace to finish browser GitHub sync in LightningFS.',
  }
}

export const classifyLightningFsBootstrap = ({
  enabled = false,
  installationConnected = false,
  repoUrl = '',
  gitStatus = null,
  remotes = [],
  rootEntries = [],
} = {}) => {
  if (!enabled) {
    return {
      state: 'disabled',
      syncReady: false,
      needsBootstrap: false,
      reason: '',
      message: '',
    }
  }

  if (!installationConnected) {
    return {
      state: 'needs-installation',
      syncReady: false,
      needsBootstrap: false,
      reason: 'installation',
      message: 'Install the GitHub App to enable workspace sync.',
    }
  }

  const normalizedTargetRepo = normalizeRepoUrl(repoUrl)
  if (!normalizedTargetRepo) {
    return {
      state: 'needs-selection',
      syncReady: false,
      needsBootstrap: false,
      reason: 'selection',
      message: 'Pick a GitHub repo for this workspace.',
    }
  }

  const rootItems = Array.isArray(rootEntries) ? rootEntries : []
  const visibleRootEntries = rootItems.filter((entry) => {
    const name = String(entry?.name || '').trim()
    return name && !LOCAL_GIT_METADATA.has(name)
  })
  const hasVisibleFiles = visibleRootEntries.length > 0

  const gitRepo = !!gitStatus?.is_repo
  const origin = Array.isArray(remotes)
    ? remotes.find((remote) => String(remote?.remote || '').trim() === 'origin')
    : null
  const normalizedOriginRepo = normalizeRepoUrl(origin?.url)

  if (gitRepo && normalizedOriginRepo && normalizedOriginRepo === normalizedTargetRepo) {
    return {
      state: 'ready',
      syncReady: true,
      needsBootstrap: false,
      reason: '',
      message: 'GitHub repo is synced into this browser workspace.',
    }
  }

  if (!gitRepo && !hasVisibleFiles) {
    return {
      state: 'needs-clone',
      syncReady: false,
      needsBootstrap: true,
      reason: 'clone',
      message: 'Loading the selected GitHub repo into this workspace.',
    }
  }

  if (gitRepo && !normalizedOriginRepo && !hasVisibleFiles) {
    return {
      state: 'needs-attach',
      syncReady: false,
      needsBootstrap: true,
      reason: 'attach',
      message: 'Attaching this browser workspace to the selected GitHub repo.',
    }
  }

  if (gitRepo && normalizedOriginRepo && normalizedOriginRepo !== normalizedTargetRepo) {
    return {
      state: 'blocked-remote-mismatch',
      syncReady: false,
      needsBootstrap: false,
      reason: 'remote-mismatch',
      message: 'This browser workspace is already bound to a different GitHub repo.',
    }
  }

  return {
    state: 'blocked-local-files',
    syncReady: false,
    needsBootstrap: false,
    reason: 'local-files',
    message: 'This browser workspace already contains files, so the selected repo was not applied automatically.',
  }
}

export const useLightningFsGitBootstrap = ({
  workspaceId,
  enabled = false,
  installationConnected = false,
  repoUrl = '',
  autoBootstrap = true,
} = {}) => {
  const provider = useOptionalDataProvider()
  const queryClient = useContext(QueryClientContext)
  const [state, setState] = useState('disabled')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [syncReady, setSyncReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lastAction, setLastAction] = useState('')
  const attemptKeyRef = useRef('')

  const remoteOpts = useMemo(() => {
    if (!enabled || !installationConnected || !repoUrl || !workspaceId) return undefined
    const proxyBaseRoute = routes.github.gitProxyBase(workspaceId)
    const corsProxy = typeof window !== 'undefined'
      ? new URL(proxyBaseRoute.path, window.location.origin).toString()
      : ''
    return {
      ...(corsProxy ? { corsProxy } : {}),
    }
  }, [enabled, installationConnected, repoUrl, workspaceId])

  const refreshQueries = useCallback(async () => {
    if (!queryClient) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.files.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.git.all }),
    ])
  }, [queryClient])

  const inspectWorkspace = useCallback(async () => {
    if (!provider) {
      return (
        buildProviderUnavailableState({ installationConnected, repoUrl })
        || classifyLightningFsBootstrap({
          enabled,
          installationConnected,
          repoUrl,
        })
      )
    }

    const [gitStatus, remotes, rootEntries] = await Promise.all([
      provider.git.status().catch(() => ({ available: true, is_repo: false, files: [] })),
      typeof provider.git.listRemotes === 'function'
        ? provider.git.listRemotes().catch(() => [])
        : Promise.resolve([]),
      provider.files.list('.').catch(() => []),
    ])

    return classifyLightningFsBootstrap({
      enabled,
      installationConnected,
      repoUrl,
      gitStatus,
      remotes,
      rootEntries,
    })
  }, [enabled, installationConnected, provider, repoUrl])

  const runBootstrap = useCallback(async () => {
    if (!enabled) {
      setState('disabled')
      setMessage('')
      setError('')
      setSyncReady(false)
      setBusy(false)
      return
    }

    const classification = await inspectWorkspace()
    setState(classification.state)
    setMessage(classification.message)
    setSyncReady(classification.syncReady)

    if (!classification.needsBootstrap) {
      setBusy(false)
      setError('')
      return classification
    }

    const attemptKey = `${workspaceId}:${repoUrl}:${classification.state}`
    if (attemptKeyRef.current === attemptKey) {
      setBusy(false)
      return classification
    }
    attemptKeyRef.current = attemptKey
    setBusy(true)
    setError('')
    setLastAction(classification.state)

    try {
      if (classification.state === 'needs-clone') {
        await provider.git.clone(repoUrl, remoteOpts || {})
      } else if (classification.state === 'needs-attach') {
        await provider.git.addRemote('origin', repoUrl)
        await provider.git.pull(remoteOpts || {})
      }

      await refreshQueries()
      const next = await inspectWorkspace()
      setState(next.state)
      setMessage(next.message)
      setSyncReady(next.syncReady)
      if (!next.syncReady) {
        attemptKeyRef.current = ''
        setError('Workspace repo bootstrap did not complete cleanly.')
      }
      return next
    } catch (err) {
      attemptKeyRef.current = ''
      setState('error')
      setMessage('Failed to load the selected GitHub repo into this workspace.')
      setError(err?.message || 'Unknown GitHub sync error')
      setSyncReady(false)
      return {
        state: 'error',
        syncReady: false,
        error: err?.message || 'Unknown GitHub sync error',
      }
    } finally {
      setBusy(false)
    }
  }, [enabled, inspectWorkspace, provider, refreshQueries, remoteOpts, repoUrl, workspaceId])

  useEffect(() => {
    attemptKeyRef.current = ''
  }, [workspaceId, repoUrl])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!autoBootstrap) {
        const result = await inspectWorkspace()
        if (cancelled) return
        setState(result.state)
        setMessage(result.message)
        setError('')
        setSyncReady(result.syncReady)
        setBusy(false)
        return
      }
      const result = await runBootstrap()
      if (cancelled || !result) return
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [autoBootstrap, inspectWorkspace, runBootstrap])

  return {
    state,
    message,
    error,
    busy,
    syncReady,
    remoteOpts,
    lastAction,
    retry: runBootstrap,
  }
}
