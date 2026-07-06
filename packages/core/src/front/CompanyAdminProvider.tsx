import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface CompanyAdminStatus {
  enabled: boolean
  admin: boolean
  role?: string | null
  details?: unknown
}

export type LoadCompanyAdminStatus = () => Promise<CompanyAdminStatus | null>
export type RenderCompanyAdminContent = (status: CompanyAdminStatus) => ReactNode

export interface CompanyAdminLabels {
  menuLabel?: string
  pageTitle?: string
  deniedMessage?: string
}

interface CompanyAdminContextValue {
  configured: boolean
  loading: boolean
  status: CompanyAdminStatus | null
  error: string | null
  renderContent: RenderCompanyAdminContent | null
  labels: CompanyAdminLabels
  refresh(): Promise<void>
}

const CompanyAdminContext = createContext<CompanyAdminContextValue>({
  configured: false,
  loading: false,
  status: null,
  error: null,
  renderContent: null,
  labels: {},
  refresh: async () => {},
})

export interface CompanyAdminProviderProps {
  children: ReactNode
  loadStatus?: LoadCompanyAdminStatus
  renderContent?: RenderCompanyAdminContent
  labels?: CompanyAdminLabels
  /**
   * Optional authenticated-user cache key. When null, status is cleared and no
   * request is made. When it changes, status is refetched.
   */
  identityKey?: string | null
}

export function CompanyAdminProvider({ children, loadStatus, renderContent, labels, identityKey }: CompanyAdminProviderProps) {
  const [status, setStatus] = useState<CompanyAdminStatus | null>(null)
  const [loading, setLoading] = useState(Boolean(loadStatus && identityKey !== null))
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    if (!loadStatus) return
    setLoading(true)
    setError(null)
    try {
      setStatus(await loadStatus())
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!loadStatus || identityKey === null) {
      setStatus(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    loadStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus(null)
          setError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [identityKey, loadStatus])

  const value = useMemo<CompanyAdminContextValue>(() => ({
    configured: Boolean(loadStatus && renderContent),
    loading,
    status,
    error,
    renderContent: renderContent ?? null,
    labels: labels ?? {},
    refresh,
  }), [error, labels, loadStatus, loading, renderContent, status])

  return <CompanyAdminContext.Provider value={value}>{children}</CompanyAdminContext.Provider>
}

export function useCompanyAdminStatus(): CompanyAdminContextValue {
  return useContext(CompanyAdminContext)
}
