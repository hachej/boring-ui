import { always } from "@antithesishq/bombadil"
import {
  actions,
  extract,
  getFingerprint,
  type Fingerprint,
  type Point,
} from "@antithesishq/bombadil/browser"
import {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties"
import { observeCommandPaletteDocument } from "./browserObservation.ts"
import { createSafeCommandPaletteActions, isCommandPaletteDialogName, isSafeCommandPaletteControl } from "./scenarioActions.ts"
import { COMMAND_PALETTE_TOUCH_EXEMPTIONS } from "./touchPolicy.ts"

export {
  noConsoleErrors,
  noHttpErrorCodes,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
}

type SafePaletteState = {
  workspaceReady: boolean
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
  lastActionWasInitial: boolean
  controls: Array<{ name: string; fingerprint: Fingerprint; point: Point }>
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
  const accessibleName = (element: Element): string => {
    const labelledBy = element.getAttribute("aria-labelledby")?.trim().split(/\s+/) ?? []
    return element.getAttribute("aria-label")
      ?? labelledBy.map((id) => state.document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim()
  }
  const completedResources = state.window.performance.getEntriesByType("resource")
    .map((entry) => entry.name)
  const workspaceReady = state.document.fonts.status === "loaded"
    && Boolean(state.document.querySelector('main[aria-label="Chat"]'))
    && completedResources.some((url) => url.includes("/api/v1/agents"))
    && completedResources.some((url) => url.includes("/api/v1/tree"))
    && completedResources.some((url) => url.includes("/api/v1/ui/state"))
  const dialogs = visibleElements('[role="dialog"], [aria-modal="true"]')
    .filter((element, index, all) => all.indexOf(element) === index)
  const dialog = dialogs.find((element) => isCommandPaletteDialogName(accessibleName(element))) ?? null
  const rootControls = Array.from(state.document.querySelectorAll(
    'button[aria-label="Search catalogs and commands"], button[data-boring-app-left-nav-key="search"], button[aria-label="Open app navigation"]',
  ))
  const allowed: Array<{ name: string; fingerprint: Fingerprint; point: Point }> = []
  const maybeAdd = (
    element: Element,
    insideDialog: boolean,
    identity?: "command-palette-trigger",
  ): void => {
    const label = normalizedText(element)
    if (!visible(element) || !isSafeCommandPaletteControl({
      tagName: element.tagName,
      label,
      type: element.getAttribute("type"),
      href: element.getAttribute("href"),
      formAction: element.getAttribute("formaction"),
      insideDialog,
      identity,
    })) return
    const fingerprint = getFingerprint(element)
    allowed.push({
      name: insideDialog
        ? `palette-mode-${label.toLowerCase()}`
        : label === "Open app navigation"
          ? "open-app-navigation"
          : "open-command-palette",
      fingerprint: {
        ...fingerprint,
        // Bombadil 0.7 matches buttons by accessible name, but its helper only
        // reads explicit ARIA/title attributes. Preserve the computed text name
        // for otherwise unnamed buttons so generated traces remain replayable.
        accessibleName: fingerprint.accessibleName ?? label,
      },
      point: center(element),
    })
  }

  if (!dialog) {
    for (const control of rootControls) {
      const identity = control.matches(
        'button[aria-label="Search catalogs and commands"], button[data-boring-app-left-nav-key="search"]',
      ) ? "command-palette-trigger" : undefined
      maybeAdd(control, false, identity)
    }
  }
  if (dialog && visible(dialog)) {
    for (const element of dialog.querySelectorAll("button")) maybeAdd(element, true)
  }

  const observation = observeCommandPaletteDocument({
    checkpoint: "explore",
    minimumTouchWidth: 44,
    minimumTouchHeight: 44,
    touchExemptions: COMMAND_PALETTE_TOUCH_EXEMPTIONS,
  })
  const active = state.document.activeElement
  const focusedControlInvalid = Boolean(observation.focusedControl && (
    observation.focusedControl.occluded
    || observation.focusedControl.bounds.x < 0
    || observation.focusedControl.bounds.y < 0
    || observation.focusedControl.bounds.x + observation.focusedControl.bounds.width > state.window.innerWidth
    || observation.focusedControl.bounds.y + observation.focusedControl.bounds.height > state.window.innerHeight
  ))
  const modalOutOfBounds = observation.visibleModals.some(({ bounds }) => (
    bounds.x < 0
    || bounds.y < 0
    || bounds.x + bounds.width > state.window.innerWidth
    || bounds.y + bounds.height > state.window.innerHeight
  ))
  const undersizedTouchTargets = state.window.innerWidth <= 500
    ? observation.undersizedTouchTargets
        .filter((target) => !target.exempt)
        .map((target) => `${target.label}:${Math.round(target.bounds.width)}x${Math.round(target.bounds.height)}`)
    : []
  const lastActionWasPaletteOpen = typeof state.lastAction === "object"
    && state.lastAction !== null
    && "Click" in state.lastAction
    && ["Search", "Search⌘K", "Search catalogs and commands"].includes(
      state.lastAction.Click.fingerprint.accessibleName ?? "",
    )
  const lastActionWasInitial = state.lastAction === null || state.lastAction === undefined
  const input = dialog?.querySelector("input") as HTMLInputElement | null
  const text = dialog?.textContent?.replace(/\s+/g, " ").trim() ?? ""
  const selectedMode = Array.from(dialog?.querySelectorAll('button[aria-pressed="true"]') ?? [])
    .map(normalizedText)[0] ?? "none"
  return {
    workspaceReady,
    dialogVisible: Boolean(dialog && visible(dialog)),
    inputFocused: active instanceof HTMLInputElement && Boolean(dialog?.contains(active)),
    mode: selectedMode,
    query: input?.value ?? "",
    empty: /no (?:commands|results|files)|nothing found/i.test(text),
    loading: /loading/i.test(text),
    error: /error|unavailable|failed/i.test(text),
    horizontalOverflow: observation.documentWidth.scrollWidth > observation.documentWidth.clientWidth,
    modalOutOfBounds,
    visibleModalCount: observation.visibleModals.length,
    focusedControlInvalid,
    undersizedTouchTargets,
    lastActionWasPaletteOpen,
    lastActionWasInitial,
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

export const commandPaletteSafeActions = actions(() => createSafeCommandPaletteActions(palette.current))
