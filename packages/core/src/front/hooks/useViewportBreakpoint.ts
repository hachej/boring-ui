import { useEffect, useState } from 'react'

export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'sm'
  if (typeof window.matchMedia !== 'function') return 'sm'

  if (window.matchMedia('(min-width: 1536px)').matches) return '2xl'
  if (window.matchMedia('(min-width: 1280px)').matches) return 'xl'
  if (window.matchMedia('(min-width: 1024px)').matches) return 'lg'
  if (window.matchMedia('(min-width: 768px)').matches) return 'md'
  return 'sm'
}

export function useViewportBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>(getBreakpoint)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const update = () => {
      setBreakpoint(getBreakpoint())
    }

    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
    }
  }, [])

  return breakpoint
}
