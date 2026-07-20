import { observeBrowserDocument, type BrowserObservation } from "../../core/browserObservation"
import type { CommandPaletteTouchExemption } from "./touchPolicy"

export type CommandPaletteSurfaceObservation = {
  checkpoint: string
  visible: boolean
  inputDividerCount: number
  dialogWidth: number | null
  keyboardHintsPresent: boolean
  commandModePressed: boolean | null
}

export type CommandPaletteBrowserObservation = BrowserObservation & {
  commandPalette: CommandPaletteSurfaceObservation
}

/** Self-contained so Playwright can serialize command-palette-specific observation. */
export function observeCommandPaletteSurface(input: { checkpoint: string }): CommandPaletteSurfaceObservation {
  const label = (element: Element): string => (
    element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.tagName.toLowerCase()
  )
  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
  }
  const dividerCount = Array.from(document.querySelectorAll('[data-slot="command-input-wrapper"]')).filter((element) => {
    const style = getComputedStyle(element)
    return parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== "none" && visible(element)
  }).length
  const dialog = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"]')).find(visible) ?? null
  const dialogContent = document.querySelector('[data-slot="dialog-content"]')
  const bodyText = document.body.innerText
  const commandMode = Array.from(document.querySelectorAll('button,[role="button"]')).find((element) => label(element) === "Commands") ?? null
  return {
    checkpoint: input.checkpoint,
    visible: Boolean(dialog),
    inputDividerCount: dividerCount,
    dialogWidth: dialogContent && visible(dialogContent) ? dialogContent.getBoundingClientRect().width : null,
    keyboardHintsPresent: /navigate/i.test(bodyText) && /open/i.test(bodyText) && /close/i.test(bodyText),
    commandModePressed: commandMode ? commandMode.getAttribute("aria-pressed") === "true" : null,
  }
}

/** Composite observer used by Bombadil's bundled browser property model. */
export function observeCommandPaletteDocument(input: {
  checkpoint: string
  minimumTouchWidth: number
  minimumTouchHeight: number
  touchExemptions: readonly CommandPaletteTouchExemption[]
}): CommandPaletteBrowserObservation {
  return {
    ...observeBrowserDocument(input),
    commandPalette: observeCommandPaletteSurface({ checkpoint: input.checkpoint }),
  }
}
