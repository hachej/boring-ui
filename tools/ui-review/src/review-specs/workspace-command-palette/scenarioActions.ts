export type ScenarioControl = {
  tagName: string
  label: string
  type?: string | null
  href?: string | null
  formAction?: string | null
  insideDialog: boolean
}

const DESTRUCTIVE_OR_EXTERNAL = /\b(delete|remove|destroy|reset|sign[ -]?out|log[ -]?out|publish|send|submit|open externally|external)\b/i

/** Pure policy used by the Bombadil scenario and unit fixtures. */
export function isSafeCommandPaletteControl(control: ScenarioControl): boolean {
  if (control.tagName.toLowerCase() !== "button") return false
  if ((control.type ?? "button").toLowerCase() === "submit") return false
  if (control.href?.trim() || control.formAction?.trim()) return false
  if (DESTRUCTIVE_OR_EXTERNAL.test(control.label)) return false
  if (control.insideDialog) return control.label === "Commands" || control.label === "Files"
  return control.label === "Open app navigation"
    || control.label === "Search catalogs and commands"
    || /^Search(?:⌘K|CtrlK)?$/.test(control.label)
}
