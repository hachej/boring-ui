import { useEffect, useState } from 'react'

export interface VisualViewportSize {
  readonly height: number
  readonly offsetTop: number
}

function measure(): VisualViewportSize {
  const viewport = window.visualViewport
  return {
    height: Math.round(viewport?.height ?? window.innerHeight),
    offsetTop: Math.round(viewport?.offsetTop ?? 0),
  }
}

/** Keep fixed phone chrome inside the visual viewport while the keyboard is open. */
export function useVisualViewport(): VisualViewportSize {
  const [viewport, setViewport] = useState<VisualViewportSize>(() => measure())

  useEffect(() => {
    let frame = 0
    const update = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const next = measure()
        setViewport((current) => current.height === next.height && current.offsetTop === next.offsetTop ? current : next)
      })
    }
    const visual = window.visualViewport
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return viewport
}
