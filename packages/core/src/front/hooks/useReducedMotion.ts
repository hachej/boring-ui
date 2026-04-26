import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState<boolean>(prefersReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia(QUERY)
    const update = (event?: MediaQueryListEvent) => {
      setReducedMotion(event?.matches ?? media.matches)
    }

    update()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }

    if (typeof media.addListener === 'function') {
      media.addListener(update)
      return () => media.removeListener(update)
    }
  }, [])

  return reducedMotion
}
