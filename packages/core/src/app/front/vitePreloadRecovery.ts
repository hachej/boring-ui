const INSTALL_FLAG = '__boringVitePreloadRecoveryInstalled__'
const RELOADED_ENTRY_KEY = 'boring-ui:vite-preload-reloaded-entry'

type RecoverableWindow = Window & {
  [INSTALL_FLAG]?: boolean
}

type VitePreloadErrorEvent = Event & {
  payload?: unknown
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>

export function currentFrontendEntry(documentRef: Document, fallback: string): string {
  const moduleScripts = Array.from(documentRef.scripts).filter((script) => (
    script.type === 'module' && Boolean(script.src)
  ))
  const assetEntry = moduleScripts.find((script) => script.src.includes('/assets/'))
  return assetEntry?.src ?? moduleScripts[0]?.src ?? fallback
}

export function shouldReloadForFrontendEntry(storage: ReloadStorage, entry: string): boolean {
  if (storage.getItem(RELOADED_ENTRY_KEY) === entry) return false
  storage.setItem(RELOADED_ENTRY_KEY, entry)
  return true
}

export function installVitePreloadRecovery(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const recoverableWindow = window as RecoverableWindow
  if (recoverableWindow[INSTALL_FLAG]) return
  recoverableWindow[INSTALL_FLAG] = true

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()

    const entry = currentFrontendEntry(document, window.location.href)
    let shouldReload = false
    try {
      shouldReload = shouldReloadForFrontendEntry(window.sessionStorage, entry)
    } catch {
      // If storage is unavailable, do not risk an infinite reload loop.
      shouldReload = false
    }

    if (!shouldReload) {
      console.warn(
        '[boring-core] dynamic import failed after a reload attempt; leaving the panel error visible.',
        (event as VitePreloadErrorEvent).payload,
      )
      return
    }

    console.warn(
      '[boring-core] dynamic import failed; reloading to pick up the latest app assets.',
      (event as VitePreloadErrorEvent).payload,
    )
    window.location.reload()
  })
}
