export type BrowserBounds = { x: number; y: number; width: number; height: number }

export type BrowserTouchExemption = {
  selector: string
  name?: string
  rationale: string
}

export type BrowserObservation = {
  origin: string
  documentWidth: { scrollWidth: number; clientWidth: number }
  visibleModals: Array<{ label: string; bounds: BrowserBounds }>
  focusedControl: { label: string; bounds: BrowserBounds; occluded: boolean } | null
  undersizedTouchTargets: Array<{
    label: string
    selector: string
    bounds: BrowserBounds
    exempt: boolean
    rationale?: string
  }>
}

/** Self-contained so Playwright and browser exploration can serialize it. */
export function observeBrowserDocument(input: {
  minimumTouchWidth: number
  minimumTouchHeight: number
  touchExemptions: readonly BrowserTouchExemption[]
}): BrowserObservation {
  const bounds = (element: Element): BrowserBounds => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  const label = (element: Element): string => (
    element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.tagName.toLowerCase()
  )
  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }
  const modalElements = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(visible)
  const active = document.activeElement instanceof Element ? document.activeElement : null
  let focusedControl: BrowserObservation["focusedControl"] = null
  if (active && active !== document.body) {
    const rect = active.getBoundingClientRect()
    const centerX = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2))
    const centerY = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2))
    const top = document.elementFromPoint(centerX, centerY)
    focusedControl = {
      label: label(active),
      bounds: bounds(active),
      occluded: Boolean(top && top !== active && !active.contains(top) && !top.contains(active)),
    }
  }
  const targets = Array.from(document.querySelectorAll('button,a[href],input,textarea,select,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])'))
    .filter(visible)
  const undersizedTouchTargets = targets.flatMap((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width >= input.minimumTouchWidth && rect.height >= input.minimumTouchHeight) return []
    const elementLabel = label(element)
    const exemption = input.touchExemptions.find((entry) => (
      element.matches(entry.selector) && (entry.name === undefined || entry.name === elementLabel)
    ))
    return [{
      label: elementLabel,
      selector: exemption?.selector ?? element.tagName.toLowerCase(),
      bounds: bounds(element),
      exempt: Boolean(exemption),
      ...(exemption ? { rationale: exemption.rationale } : {}),
    }]
  })
  return {
    origin: location.origin,
    documentWidth: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    visibleModals: modalElements.map((element) => ({ label: label(element), bounds: bounds(element) })),
    focusedControl,
    undersizedTouchTargets,
  }
}
