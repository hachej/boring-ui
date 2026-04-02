import { useEffect, useMemo, useState } from 'react'
import {
  createQueryClient,
  getDataProvider,
  getDataProviderFactory,
  createHttpProvider,
  createJustBashDataProvider,
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
  const [dataProviderCache] = useState(() => new Map())
  const [queryClientCache] = useState(() => new Map())

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
  const justBashProviderCacheKey = `user:${lightningFsUserScope}|workspace:${lightningFsWorkspaceScope}|session:${lightningFsSessionScope}`
  const isLightningBackend = (
    configuredDataBackend === 'lightningfs' || configuredDataBackend === 'lightning-fs'
  )
  const isJustBashBackend = configuredDataBackend === 'justbash'
  const dataProviderScopeKey = (
    isLightningBackend
      ? `lightningfs:${lightningFsProviderCacheKey}`
      : isJustBashBackend
        ? `justbash:${justBashProviderCacheKey}`
      : `backend:${configuredDataBackend || 'http'}`
  )
  const queryClient = useMemo(
    () => getCachedScopedValue(
      queryClientCache,
      dataProviderScopeKey,
      () => createQueryClient(),
      (client) => client?.clear?.(),
    ),
    [dataProviderScopeKey, queryClientCache],
  )
  const dataProvider = useMemo(
    () => {
      const injected = getDataProvider()
      if (injected) return injected

      if (!configuredDataBackend || configuredDataBackend === 'http') {
        return createHttpProvider({ workspaceId: currentWorkspaceId })
      }

      if (isLightningBackend) {
        return getCachedScopedValue(
          dataProviderCache,
          lightningFsProviderCacheKey,
          () => createLightningDataProvider({ fsName: resolvedLightningFsName }),
        )
      }

      if (isJustBashBackend) {
        return getCachedScopedValue(
          dataProviderCache,
          justBashProviderCacheKey,
          () => createJustBashDataProvider(),
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
      dataProviderCache,
      isJustBashBackend,
      isLightningBackend,
      justBashProviderCacheKey,
      lightningFsProviderCacheKey,
      resolvedLightningFsName,
      strictDataBackend,
    ],
  )

  useEffect(() => {
    if (!isLightningBackend && !isJustBashBackend) return
    if (!isStableLightningUserScope(lightningFsUserScope)) return

    const providerKeyPrefix = `user:${lightningFsUserScope}|`
    const queryKeyPrefix = isLightningBackend
      ? `lightningfs:${providerKeyPrefix}`
      : `justbash:${providerKeyPrefix}`
    const queryKeyStartsWith = isLightningBackend ? 'lightningfs:' : 'justbash:'

    Array.from(dataProviderCache.keys()).forEach((key) => {
      if (key.startsWith(providerKeyPrefix)) return
      dataProviderCache.delete(key)
    })

    Array.from(queryClientCache.entries()).forEach(([key, client]) => {
      if (!key.startsWith(queryKeyStartsWith)) return
      if (key.startsWith(queryKeyPrefix)) return
      client?.clear?.()
      queryClientCache.delete(key)
    })
  }, [dataProviderCache, isJustBashBackend, isLightningBackend, lightningFsUserScope, queryClientCache])

  return {
    configuredDataBackend,
    dataProviderScopeKey,
    queryClient,
    dataProvider,
  }
}
