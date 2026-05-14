/**
 * Copy `text` to the clipboard. Falls back to a hidden-textarea + execCommand
 * when `navigator.clipboard` is unavailable (non-secure contexts: plain http
 * served from a non-localhost IP, file://, etc.).
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some browsers reject when not focused — fall through to legacy path.
    }
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard not available")
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.top = "-9999px"
  ta.style.left = "-9999px"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  let ok = false
  try {
    ta.focus()
    ta.select()
    ok = !!document.execCommand?.("copy")
  } finally {
    document.body.removeChild(ta)
  }
  if (!ok) throw new Error("Clipboard not available")
}
