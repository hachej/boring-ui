/**
 * useReducedMotion — listens to the prefers-reduced-motion media query.
 *
 * Returns true when the user has requested reduced motion in their OS settings.
 * Components use this to disable or shorten spring/transition animations.
 *
 * @returns {boolean}
 */

import { useState, useEffect } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * @returns {boolean} true when the user prefers reduced motion
 */
export function useReducedMotion() {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(QUERY).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const mql = window.matchMedia(QUERY)

    function handleChange(event) {
      setMatches(event.matches)
    }

    mql.addEventListener('change', handleChange)

    return () => {
      mql.removeEventListener('change', handleChange)
    }
  }, [])

  return matches
}
