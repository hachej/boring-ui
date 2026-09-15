import { useEffect, useRef, useState, type FormEvent } from 'react'

import type { AppOverlay, OneChatAppView } from './useApps'

interface AppRailProps {
  readonly apps: readonly OneChatAppView[]
  readonly activeApp: OneChatAppView | null
  readonly overlay: AppOverlay
  readonly mobile: boolean
  readonly creating: boolean
  readonly onSelect: (slug: string) => void
  readonly onOpenApps: () => void
  readonly onOpenNew: () => void
  readonly onClose: () => void
  readonly onCreate: (title: string) => Promise<unknown>
}

function AppInitial({ app }: { app: OneChatAppView }) {
  return <span aria-hidden="true">{app.title.trim().charAt(0).toLocaleUpperCase() || 'A'}</span>
}

function CreateForm({ creating, onCreate }: Pick<AppRailProps, 'creating' | 'onCreate'>) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || creating) return
    setError(null)
    try {
      await onCreate(title)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <form className="one-chat-create-form" onSubmit={submit} data-testid="one-chat-create-form">
      <label htmlFor="one-chat-app-title">App name</label>
      <div className="one-chat-create-row">
        <input
          id="one-chat-app-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Client portal"
          maxLength={80}
          autoFocus
        />
        <button type="submit" disabled={!title.trim() || creating}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  )
}

function AppsList({ apps, activeApp, onSelect }: Pick<AppRailProps, 'apps' | 'activeApp' | 'onSelect'>) {
  return (
    <div className="one-chat-app-list">
      {apps.map((app) => (
        <button
          key={app.slug}
          type="button"
          className="one-chat-app-list-item"
          data-active={app.slug === activeApp?.slug ? '' : undefined}
          aria-current={app.slug === activeApp?.slug ? 'page' : undefined}
          onClick={() => onSelect(app.slug)}
        >
          <span className="one-chat-list-initial"><AppInitial app={app} /></span>
          <span>{app.title}</span>
        </button>
      ))}
    </div>
  )
}

export function AppRail(props: AppRailProps) {
  const sheetRef = useRef<HTMLElement>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!props.mobile || !props.overlay || !sheetRef.current) return
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const sheet = sheetRef.current
    const focusable = () => [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (priorFocusRef.current?.isConnected) priorFocusRef.current.focus()
    }
  }, [props.mobile, props.onClose, props.overlay])

  if (props.mobile) {
    return (
      <>
        <button
          type="button"
          className="one-chat-mobile-app-bar"
          data-testid="one-chat-mobile-app-bar"
          onClick={props.onOpenApps}
          aria-expanded={props.overlay !== null}
          aria-controls="one-chat-app-sheet"
        >
          <span className="one-chat-mobile-app-mark">
            {props.activeApp ? <AppInitial app={props.activeApp} /> : <PlusIcon />}
          </span>
          <span className="one-chat-mobile-app-title">{props.activeApp?.title ?? 'New app'}</span>
          <ChevronIcon />
        </button>
        {props.overlay ? (
          <div className="one-chat-app-sheet-layer" data-testid="one-chat-app-sheet-layer">
            <button type="button" className="one-chat-sheet-scrim" aria-label="Close app list" onClick={props.onClose} />
            <section
              ref={sheetRef}
              id="one-chat-app-sheet"
              className="one-chat-app-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="one-chat-app-sheet-title"
              tabIndex={-1}
            >
              <div className="one-chat-sheet-handle" aria-hidden="true" />
              <header>
                <h2 id="one-chat-app-sheet-title">{props.overlay === 'new' ? 'A fresh workspace' : 'Your apps'}</h2>
                <button type="button" onClick={props.onClose} aria-label="Close">×</button>
              </header>
              {props.overlay === 'new' ? (
                <CreateForm creating={props.creating} onCreate={props.onCreate} />
              ) : (
                <>
                  <AppsList apps={props.apps} activeApp={props.activeApp} onSelect={props.onSelect} />
                  <button type="button" className="one-chat-sheet-new" onClick={props.onOpenNew}>
                    <PlusIcon /> <span>New app</span>
                  </button>
                  <div className="one-chat-sheet-profile">
                    <span className="one-chat-profile-avatar">Y</span>
                    <span><strong>Your profile</strong><small>Signed in</small></span>
                    <button type="button" onClick={() => {}} aria-label="Sign out (not available yet)" title="Sign out is not wired yet">
                      <SignOutIcon />
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <aside className="one-chat-rail" aria-label="Your apps" data-testid="one-chat-rail">
      <button type="button" className="one-chat-rail-add" onClick={props.onOpenNew} title="Create a new app" aria-label="Create a new app">
        <PlusIcon />
      </button>
      <nav>
        {props.apps.map((app) => (
          <button
            key={app.slug}
            type="button"
            className="one-chat-rail-app"
            data-active={app.slug === props.activeApp?.slug ? '' : undefined}
            aria-current={app.slug === props.activeApp?.slug ? 'page' : undefined}
            title={app.title}
            aria-label={app.title}
            onClick={() => props.onSelect(app.slug)}
          >
            <AppInitial app={app} />
          </button>
        ))}
      </nav>
      <button type="button" className="one-chat-rail-profile" title="Your profile · sign out coming soon" aria-label="Your profile">
        Y
      </button>
      {props.overlay === 'new' ? (
        <div className="one-chat-rail-form-panel">
          <p>New app</p>
          <CreateForm creating={props.creating} onCreate={props.onCreate} />
        </div>
      ) : null}
    </aside>
  )
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}

function ChevronIcon() {
  return <svg className="one-chat-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5" /></svg>
}

function SignOutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h9" /></svg>
}
