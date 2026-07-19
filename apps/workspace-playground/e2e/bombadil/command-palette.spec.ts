import { always } from "@antithesishq/bombadil"
import {
  actions,
  extract,
  type Action,
  type Point,
} from "@antithesishq/bombadil/browser"
import {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties"
import { isSafeCommandPaletteControl } from "../../src/ui-review/scenarioActions.ts"

export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
}

type SafePaletteState = {
  dialogVisible: boolean
  inputFocused: boolean
  mode: string
  query: string
  empty: boolean
  loading: boolean
  error: boolean
  horizontalOverflow: boolean
  modalOutOfBounds: boolean
  visibleModalCount: number
  focusedControlInvalid: boolean
  undersizedTouchTargets: string[]
  lastActionWasPaletteOpen: boolean
  controls: Array<{ name: string; point: Point }>
}

const palette = extract((state): SafePaletteState => {
  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect()
    const style = state.window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
  }
  const center = (element: Element): Point => {
    const rect = element.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  const normalizedText = (element: Element): string => (
    element.getAttribute("aria-label") ?? element.textContent ?? ""
  ).replace(/\s+/g, " ").trim()
  const visibleElements = (selector: string): Element[] => Array.from(state.document.querySelectorAll(selector)).filter(visible)
  const dialogs = visibleElements('[role="dialog"], [aria-modal="true"]')
    .filter((element, index, all) => all.indexOf(element) === index)
  const dialog = dialogs[0] ?? null
  const searchControls = Array.from(state.document.querySelectorAll("button"))
  const allowed: Array<{ name: string; point: Point }> = []
  const maybeAdd = (element: Element, insideDialog: boolean): void => {
    const label = normalizedText(element)
    if (!visible(element) || !isSafeCommandPaletteControl({
      tagName: element.tagName,
      label,
      type: element.getAttribute("type"),
      href: element.getAttribute("href"),
      formAction: element.getAttribute("formaction"),
      insideDialog,
    })) return
    allowed.push({
      name: insideDialog
        ? `palette-mode-${label.toLowerCase()}`
        : label === "Open app navigation"
          ? "open-app-navigation"
          : "open-command-palette",
      point: center(element),
    })
  }

  if (!dialog) {
    for (const search of searchControls) maybeAdd(search, false)
  }
  if (dialog && visible(dialog)) {
    for (const element of dialog.querySelectorAll("button")) maybeAdd(element, true)
  }

  const active = state.document.activeElement
  const activeRect = active instanceof Element ? active.getBoundingClientRect() : null
  const focusedControlInvalid = Boolean(activeRect && active !== state.document.body && (
    activeRect.left < 0
    || activeRect.top < 0
    || activeRect.right > state.window.innerWidth
    || activeRect.bottom > state.window.innerHeight
    || (() => {
      const x = Math.max(0, Math.min(state.window.innerWidth - 1, activeRect.left + activeRect.width / 2))
      const y = Math.max(0, Math.min(state.window.innerHeight - 1, activeRect.top + activeRect.height / 2))
      const top = state.document.elementFromPoint(x, y)
      return Boolean(top && top !== active && !active.contains(top) && !top.contains(active))
    })()
  ))
  const modalOutOfBounds = dialogs.some((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left < 0 || rect.top < 0 || rect.right > state.window.innerWidth || rect.bottom > state.window.innerHeight
  })
  const touchExempt = (element: Element, label: string): boolean => (
    element.matches('[role="group"][aria-label="Palette mode"] button, input[cmdk-input], button[aria-label$="in new chat pane"]')
    || [
      "Workspace", "Attach files", "Agent prompt", "Submit", "Thinking level: Med", "Hide workspace menu",
      "Files", "Open app navigation", "New chat", "Inbox", "Tasks", "Plugins", "Skills", "Toggle theme", "Hide app navigation",
    ].includes(label)
    || label.startsWith("Open model picker. Current model:")
    || label.startsWith("Pin ")
    || label.startsWith("Delete ")
    || /^Search(?:⌘K|CtrlK)?$/.test(label)
  )
  const undersizedTouchTargets = state.window.innerWidth <= 500
    ? visibleElements('button,a[href],input,textarea,select,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])')
        .flatMap((element) => {
          const rect = element.getBoundingClientRect()
          const label = normalizedText(element)
          return rect.width < 44 || rect.height < 44
            ? touchExempt(element, label) ? [] : [`${label}:${Math.round(rect.width)}x${Math.round(rect.height)}`]
            : []
        })
    : []
  const lastActionWasPaletteOpen = typeof state.lastAction === "object"
    && state.lastAction !== null
    && "Click" in state.lastAction
    && state.lastAction.Click.name === "open-command-palette"
  const input = dialog?.querySelector("input") as HTMLInputElement | null
  const text = dialog?.textContent?.replace(/\s+/g, " ").trim() ?? ""
  const selectedMode = Array.from(dialog?.querySelectorAll('button[aria-pressed="true"]') ?? [])
    .map(normalizedText)[0] ?? "none"
  return {
    dialogVisible: Boolean(dialog && visible(dialog)),
    inputFocused: active instanceof HTMLInputElement && Boolean(dialog?.contains(active)),
    mode: selectedMode,
    query: input?.value ?? "",
    empty: /no (?:commands|results|files)|nothing found/i.test(text),
    loading: /loading/i.test(text),
    error: /error|unavailable|failed/i.test(text),
    horizontalOverflow: state.document.documentElement.scrollWidth > state.document.documentElement.clientWidth,
    modalOutOfBounds,
    visibleModalCount: dialogs.length,
    focusedControlInvalid,
    undersizedTouchTargets,
    lastActionWasPaletteOpen,
    controls: allowed,
  }
})

/**
 * Scenario-owned actions are deliberately narrower than Bombadil defaults.
 * They can open/close the palette, change its non-mutating mode, and type
 * bounded fixture queries. They never click links, command results, submit
 * controls, destructive labels, or anything outside the palette allowlist.
 */
export const command_palette_has_no_horizontal_overflow = always(() => !palette.current.horizontalOverflow)
export const command_palette_modals_stay_in_viewport = always(() => !palette.current.modalOutOfBounds)
export const command_palette_has_at_most_one_modal = always(() => palette.current.visibleModalCount <= 1)
export const command_palette_focus_stays_visible = always(() => !palette.current.focusedControlInvalid)
export const command_palette_mobile_touch_targets_are_sized = always(() => palette.current.undersizedTouchTargets.length === 0)

export const commandPaletteSafeActions = actions((): Action[] => {
  const openPalette = palette.current.controls.find((control) => control.name === "open-command-palette")
  if (!palette.current.dialogVisible && openPalette) {
    return ["Wait", { Click: { name: openPalette.name, content: null, point: openPalette.point } }]
  }
  const openNavigation = palette.current.controls.find((control) => control.name === "open-app-navigation")
  if (!palette.current.dialogVisible && openNavigation) {
    return ["Wait", { Click: { name: openNavigation.name, content: null, point: openNavigation.point } }]
  }
  if (palette.current.dialogVisible && palette.current.lastActionWasPaletteOpen) return ["Wait"]
  const generated: Action[] = ["Wait"]
  for (const control of palette.current.controls) {
    generated.push({ Click: control })
  }
  if (palette.current.dialogVisible) generated.push({ PressKey: { code: 27 } })
  if (palette.current.inputFocused) {
    generated.push(
      { TypeText: { text: ">", delayMillis: 0 } },
      { TypeText: { text: "no-matching-fixture-command", delayMillis: 0 } },
    )
  }
  return generated
})
