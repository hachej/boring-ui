import { useEffect, useMemo, useRef } from 'react'
import {
  createQueryClient,
  getDataProvider,
  getDataProviderFactory,
  createHttpProvider,
  createLightningDataProvider,
} from '../providers/data'
import {
  buildLightningFsNamespace,
  resolveLightningFsUserScope,
  resolveLightningFsWorkspaceScope,
} from '../providers/data/lightningFsNamespace'
import { getFrontendStateClientId } from '../utils/frontendState'
import { getCachedScopedValue, isStableLightningUserScope } from '../utils/panelConfig'

export default function useDataProviderScope({
  config,
  storagePrefix,
  currentWorkspaceId,
  menuUserId,
  menuUserEmail,
  userMenuAuthStatus,
}) {
  const dataProviderCacheRef = useRef(new Map())
  const queryClientCacheRef = useRef(new Map())

  const configuredDataBackend = String(config?.data?.backend || 'http')
    .trim()
    .toLowerCase()
  const lightningFsSessionScope = useMemo(
    () => getFrontendStateClientId(storagePrefix),
    [storagePrefix],
  )
  const configuredLightningFsBaseName = String(
    config?.data?.lightningfs?.name || 'boring-fs',
  ).trim()
  const lightningFsUserScope = useMemo(
    () => resolveLightningFsUserScope({
      userId: menuUserId,
      userEmail: menuUserEmail,
      authStatus: userMenuAuthStatus,
      sessionScope: lightningFsSessionScope,
    }),
    [menuUserId, menuUserEmail, userMenuAuthStatus, lightningFsSessionScope],
  )
  const lightningFsWorkspaceScope = useMemo(
    () => resolveLightningFsWorkspaceScope(currentWorkspaceId),
    [currentWorkspaceId],
  )
  const resolvedLightningFsName = useMemo(
    () => buildLightningFsNamespace({
      baseName: configuredLightningFsBaseName,
      origin: typeof window !== 'undefined' ? window.location.origin : 'local',
      userScope: lightningFsUserScope,
      workspaceScope: lightningFsWorkspaceScope,
    }),
    [
      configuredLightningFsBaseName,
      lightningFsUserScope,
      lightningFsWorkspaceScope,
    ],
  )
  const strictDataBackend = Boolean(config?.data?.strictBackend)
  const lightningFsProviderCacheKey = `user:${lightningFsUserScope}|fs:${resolvedLightningFsName}`
  const dataProviderScopeKey = (
    configuredDataBackend === 'lightningfs' || configuredDataBackend === 'lightning-fs'
      ? `lightningfs:${lightningFsProviderCacheKey}`
      : `backend:${configuredDataBackend || 'http'}`
  )
  const queryClient = useMemo(
    () => getCachedScopedValue(
      queryClientCacheRef.current,
      dataProviderScopeKey,
      () => createQueryClient(),
      (client) => client?.clear?.(),
    ),
    [dataProviderScopeKey],
  )
  const dataProvider = useMemo(
    () => {
      const injected = getDataProvider()
      if (injected) return injected

      if (!configuredDataBackend || configuredDataBackend === 'http') {
        return createHttpProvider({ workspaceId: currentWorkspaceId })
      }

      if (configuredDataBackend === 'lightningfs' || configuredDataBackend === 'lightning-fs') {
        return getCachedScopedValue(
          dataProviderCacheRef.current,
          lightningFsProviderCacheKey,
          () => createLightningDataProvider({ fsName: resolvedLightningFsName }),
        )
      }

      const factory = getDataProviderFactory(configuredDataBackend)
      if (factory) return factory()

      if (strictDataBackend) {
        throw new Error(
          `[DataProvider] Unknown configured backend "${configuredDataBackend}" (strict mode enabled)`,
        )
      }

      console.warn(
        `[DataProvider] Unknown configured backend "${configuredDataBackend}", falling back to http`,
      )
      return createHttpProvider({ workspaceId: currentWorkspaceId })
    },
    [
      configuredDataBackend,
      currentWorkspaceId,
      lightningFsProviderCacheKey,
      resolvedLightningFsName,
      strictDataBackend,
    ],
  )

  useEffect(() => {
    const isLightningBackend = (
      configuredDataBackend === 'lightningfs'
      || configuredDataBackend === 'lightning-fs'
    )
    if (!isLightningBackend) return
    if (!isStableLightningUserScope(lightningFsUserScope)) return

    const providerKeyPrefix = `user:${lightningFsUserScope}|`
    const queryKeyPrefix = `lightningfs:${providerKeyPrefix}`

    Array.from(dataProviderCacheRef.current.keys()).forEach((key) => {
      if (key.startsWith(providerKeyPrefix)) return
      dataProviderCacheRef.current.delete(key)
    })

    Array.from(queryClientCacheRef.current.entries()).forEach(([key, client]) => {
      if (!key.startsWith('lightningfs:')) return
      if (key.startsWith(queryKeyPrefix)) return
      client?.clear?.()
      queryClientCacheRef.current.delete(key)
    })
  }, [configuredDataBackend, lightningFsUserScope])

  return {
    configuredDataBackend,
    dataProviderScopeKey,
    queryClient,
    dataProvider,
  }
}
