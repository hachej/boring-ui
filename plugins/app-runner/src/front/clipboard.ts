/**
 * Copy `text` to the clipboard. Falls back to a hidden-textarea +
 * `execCommand` when `navigator.clipboard` is unavailable (non-secure
 * contexts, older browsers, etc.). Resolves to whether the copy succeeded;
 * never throws, so callers can surface a best-effort UI state.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Some browsers reject when the document isn't focused — fall through.
    }
  }
  if (typeof document === "undefined") return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  let ok = false
  try {
    textarea.focus()
    textarea.select()
    ok = !!document.execCommand?.("copy")
  } finally {
    document.body.removeChild(textarea)
  }
  return ok
}
