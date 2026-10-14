// Pinned shadcn fixture: `shadcn@4.21.4 add drawer sidebar avatar dropdown-menu` (style base-nova, icons lucide), generated 2026-10-13
// from https://ui.shadcn.com/r/styles/base-nova/. Used only to type-check and run registry/app-shell; consumers install their own.
import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
