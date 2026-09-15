import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

const WINDOW_WIDTH = 420
const WINDOW_HEIGHT = 560
const VIEWPORT_PADDING = 16

interface Position {
  readonly left: number
  readonly top: number
}

interface ChatWindowProps {
  readonly title: string
  readonly subtitle: string
  readonly icon: ReactNode
  readonly ariaLabel: string
  readonly onClose?: () => void
  readonly onDock: () => void
  readonly children: ReactNode
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampToViewport(position: Position): Position {
  const width = Math.min(WINDOW_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const height = Math.min(WINDOW_HEIGHT, window.innerHeight - VIEWPORT_PADDING * 2)
  return {
    left: clamp(position.left, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING)),
    top: clamp(position.top, VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING)),
  }
}

function initialPosition(): Position {
  return clampToViewport({
    left: window.innerWidth - WINDOW_WIDTH - VIEWPORT_PADDING,
    top: window.innerHeight - WINDOW_HEIGHT - VIEWPORT_PADDING,
  })
}

export function ChatWindow({
  title,
  subtitle,
  icon,
  ariaLabel,
  onClose,
  onDock,
  children,
}: ChatWindowProps) {
  const [position, setPosition] = useState(initialPosition)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  const stopDrag = useCallback(() => {
    if (!dragRef.current) return
    dragRef.current = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const moveWindow = useCallback((event: PointerEvent) => {
    const previous = dragRef.current
    if (!previous) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    setPosition((current) => clampToViewport({
      left: current.left + event.clientX - previous.x,
      top: current.top + event.clientY - previous.y,
    }))
  }, [])

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('button, a, input, textarea, select')) return
    dragRef.current = { x: event.clientX, y: event.clientY }
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const keepInViewport = () => setPosition((current) => clampToViewport(current))
    window.addEventListener('pointermove', moveWindow)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    window.addEventListener('resize', keepInViewport)
    return () => {
      window.removeEventListener('pointermove', moveWindow)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
      window.removeEventListener('resize', keepInViewport)
      stopDrag()
    }
  }, [moveWindow, stopDrag])

  return (
    <section
      className="one-chat-window-frame"
      data-testid="one-chat-window-frame"
      role="dialog"
      aria-label={ariaLabel}
      style={{ left: position.left, top: position.top }}
    >
      <header className="one-chat-window-header" onPointerDown={startDrag}>
        <div className="one-chat-window-heading">
          <span className="one-chat-window-icon">{icon}</span>
          <span className="one-chat-window-titles">
            <strong>{title}</strong>
            <small>{subtitle}</small>
          </span>
        </div>
        <div className="one-chat-window-actions">
          <button type="button" aria-label="Dock panel" title="Dock" onClick={onDock}>
            <DockIcon />
          </button>
          {onClose ? (
            <button type="button" aria-label="Close panel" title="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          ) : null}
        </div>
      </header>
      <div className="one-chat-window-body">{children}</div>
    </section>
  )
}

function DockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}
