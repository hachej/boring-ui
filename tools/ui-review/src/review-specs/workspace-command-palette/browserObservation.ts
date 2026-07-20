import type { CommandPaletteTouchExemption } from "./touchPolicy"

export type CommandPaletteBrowserObservation = {
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
  commandPalette: {
    checkpoint: string
    visible: boolean
    inputDividerCount: number
    dialogWidth: number | null
    keyboardHintsPresent: boolean
    commandModePressed: boolean | null
  }
}

type BrowserBounds = { x: number; y: number; width: number; height: number }

/** Self-contained so Playwright and Bombadil can serialize the same browser observer. */
export function observeCommandPaletteDocument(input: {
  checkpoint: string
  minimumTouchWidth: number
  minimumTouchHeight: number
  touchExemptions: readonly CommandPaletteTouchExemption[]
}): CommandPaletteBrowserObservation {
  const bounds = (element: Element): BrowserBounds => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  const label = (element: Element): string => (
    element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.tagName.toLowerCase()
  )
  const isVisible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }
  const modalElements = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]'))
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter(isVisible)
  const active = document.activeElement instanceof Element ? document.activeElement : null
  let focusedControl: CommandPaletteBrowserObservation["focusedControl"] = null
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
    .filter(isVisible)
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
  const dividerCount = Array.from(document.querySelectorAll('[data-slot="command-input-wrapper"]')).filter((element) => {
    const style = getComputedStyle(element)
    return parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none" && isVisible(element)
  }).length
  const dialog = modalElements[0] ?? null
  const dialogContent = document.querySelector('[data-slot="dialog-content"]')
  const bodyText = document.body.innerText
  const commandMode = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) => label(element) === "Commands") ?? null

  return {
    origin: location.origin,
    documentWidth: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    visibleModals: modalElements.map((element) => ({ label: label(element), bounds: bounds(element) })),
    focusedControl,
    undersizedTouchTargets,
    commandPalette: {
      checkpoint: input.checkpoint,
      visible: Boolean(dialog),
      inputDividerCount: dividerCount,
      dialogWidth: dialogContent && isVisible(dialogContent) ? dialogContent.getBoundingClientRect().width : null,
      keyboardHintsPresent: /navigate/i.test(bodyText) && /open/i.test(bodyText) && /close/i.test(bodyText),
      commandModePressed: commandMode ? commandMode.getAttribute("aria-pressed") === "true" : null,
    },
  }
}
