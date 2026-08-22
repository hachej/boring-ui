import type { ActionTemplate, Fingerprint, Point } from "@antithesishq/bombadil/browser"

export type ScenarioControl = {
  tagName: string
  label: string
  type?: string | null
  href?: string | null
  formAction?: string | null
  insideDialog: boolean
  identity?: "command-palette-trigger"
}

type ScenarioActionControl = {
  name: string
  fingerprint: Fingerprint
  point: Point
}
export type ScenarioAction = ActionTemplate

export type ScenarioActionState = {
  dialogVisible: boolean
  inputFocused: boolean
  lastActionWasPaletteOpen: boolean
  lastActionWasInitial: boolean
  controls: ScenarioActionControl[]
}

const DESTRUCTIVE_OR_EXTERNAL = /\b(delete|remove|destroy|reset|sign[ -]?out|log[ -]?out|publish|send|submit|open externally|external)\b/i

export function isCommandPaletteDialogName(name: string): boolean {
  return /^command palette$/i.test(name.trim())
}

/** Pure policy used by the Bombadil scenario and unit fixtures. */
export function isSafeCommandPaletteControl(control: ScenarioControl): boolean {
  if (control.tagName.toLowerCase() !== "button") return false
  if ((control.type ?? "button").toLowerCase() === "submit") return false
  if (control.href?.trim() || control.formAction?.trim()) return false
  if (DESTRUCTIVE_OR_EXTERNAL.test(control.label)) return false
  if (control.insideDialog) return control.label === "Commands" || control.label === "Files"
  return control.identity === "command-palette-trigger"
    || control.label === "Open app navigation"
    || control.label === "Search catalogs and commands"
}

export function createSafeCommandPaletteActions(state: ScenarioActionState): ScenarioAction[] {
  const click = ({ fingerprint, point }: ScenarioActionControl): ScenarioAction => ({
    Click: { fingerprint, point },
  })

  if (state.lastActionWasInitial) return ["Wait"]
  const openPalette = state.controls.find((control) => control.name === "open-command-palette")
  if (!state.dialogVisible && openPalette) return ["Wait", click(openPalette)]
  const openNavigation = state.controls.find((control) => control.name === "open-app-navigation")
  if (!state.dialogVisible && openNavigation) return ["Wait", click(openNavigation)]
  if (state.dialogVisible && state.lastActionWasPaletteOpen) return ["Wait"]

  const generated: ScenarioAction[] = ["Wait"]
  for (const control of state.controls) generated.push(click(control))
  if (state.dialogVisible) generated.push({ PressKey: { code: 27 } })
  if (state.inputFocused) {
    generated.push(
      { TypeText: { text: { Regexp: ">" }, delayMillis: 0 } },
      { TypeText: { text: { Regexp: "no-matching-fixture-command" }, delayMillis: 0 } },
    )
  }
  return generated
}
