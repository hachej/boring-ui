import { useCallback, useEffect, useMemo, useState } from 'react'

export interface OneChatAppView {
  readonly slug: string
  readonly title: string
  readonly createdAt: string
  readonly port: number
  readonly url: string
}

export type AppOverlay = 'apps' | 'new' | null

const LAST_APP_KEY = 'one-chat:last-app'
const HISTORY_OWNER = 'one-chat'

interface OneChatHistoryState {
  readonly owner?: string
  readonly overlay?: AppOverlay
}

function storedLastApp(): string | null {
  try {
    return window.localStorage.getItem(LAST_APP_KEY)
  } catch {
    return null
  }
}

function storeLastApp(slug: string): void {
  try {
    window.localStorage.setItem(LAST_APP_KEY, slug)
  } catch {
    // URL state remains authoritative when storage is unavailable.
  }
}

function slugFromPath(): string | null {
  const match = window.location.pathname.match(/^\/apps\/([^/]+)\/?$/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}

function overlayFromUrl(): AppOverlay {
  const value = new URLSearchParams(window.location.search).get('panel')
  return value === 'apps' || value === 'new' ? value : null
}

function historyState(overlay: AppOverlay): OneChatHistoryState {
  return { owner: HISTORY_OWNER, ...(overlay ? { overlay } : {}) }
}

function replaceUrl(pathname: string, overlay: AppOverlay = null): void {
  const url = new URL(window.location.href)
  url.pathname = pathname
  if (overlay) url.searchParams.set('panel', overlay)
  else url.searchParams.delete('panel')
  window.history.replaceState(historyState(overlay), '', `${url.pathname}${url.search}${url.hash}`)
}

function pushUrl(pathname: string, overlay: AppOverlay = null): void {
  const url = new URL(window.location.href)
  url.pathname = pathname
  if (overlay) url.searchParams.set('panel', overlay)
  else url.searchParams.delete('panel')
  window.history.pushState(historyState(overlay), '', `${url.pathname}${url.search}${url.hash}`)
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
}

export function useApps() {
  const [apps, setApps] = useState<readonly OneChatAppView[]>([])
  const [activeSlug, setActiveSlug] = useState<string | null>(() => slugFromPath())
  const [overlay, setOverlayState] = useState<AppOverlay>(() => overlayFromUrl())
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onPop = () => {
      setActiveSlug(slugFromPath())
      setOverlayState(overlayFromUrl())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/one-chat/apps')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load apps (${response.status})`)
        return response.json() as Promise<{ apps?: OneChatAppView[] }>
      })
      .then((body) => {
        if (cancelled) return
        const next = body.apps ?? []
        setApps(next)
        if (window.location.pathname === '/') {
          const last = storedLastApp()
          const destination = next.find((app) => app.slug === last)?.slug ?? next[0]?.slug
          replaceUrl(destination ? `/apps/${encodeURIComponent(destination)}` : '/new', destination ? null : 'new')
          setActiveSlug(destination ?? null)
          setOverlayState(destination ? null : 'new')
        } else if (window.location.pathname === '/new') {
          setActiveSlug(null)
          setOverlayState('new')
        }
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause))
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (activeSlug) storeLastApp(activeSlug)
  }, [activeSlug])

  const navigateTo = useCallback((slug: string) => {
    storeLastApp(slug)
    pushUrl(`/apps/${encodeURIComponent(slug)}`)
  }, [])

  const setOverlay = useCallback((next: AppOverlay) => {
    if (next === overlay) return
    const pathname = activeSlug ? `/apps/${encodeURIComponent(activeSlug)}` : '/new'
    pushUrl(pathname, next)
  }, [activeSlug, overlay])

  const closeOverlay = useCallback(() => {
    if (!overlay) return
    const state = window.history.state as OneChatHistoryState | null
    if (state?.owner === HISTORY_OWNER && state.overlay === overlay) window.history.back()
    else {
      const pathname = activeSlug ? `/apps/${encodeURIComponent(activeSlug)}` : '/new'
      replaceUrl(pathname)
      setOverlayState(null)
    }
  }, [activeSlug, overlay])

  const create = useCallback(async (title: string) => {
    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/one-chat/apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await response.json() as OneChatAppView & { message?: string }
      if (!response.ok) throw new Error(body.message ?? `Could not create app (${response.status})`)
      setApps((current) => [...current, body])
      storeLastApp(body.slug)
      pushUrl(`/apps/${encodeURIComponent(body.slug)}`)
      return body
    } finally {
      setCreating(false)
    }
  }, [])

  const activeApp = useMemo(() => apps.find((app) => app.slug === activeSlug) ?? null, [activeSlug, apps])
  return {
    apps,
    activeApp,
    activeSlug,
    overlay,
    loading,
    creating,
    error,
    navigateTo,
    setOverlay,
    closeOverlay,
    create,
  }
}
