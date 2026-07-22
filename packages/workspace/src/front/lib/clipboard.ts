export interface CopyTextOptions {
  /** Restore focus after the legacy textarea fallback temporarily takes it. */
  fallbackFocusTarget?: HTMLElement | null
  /**
   * Preserve a caller's legacy secure-context behavior when the Clipboard API
   * is unsupported or denied. The default keeps an HTTPS permission failure
   * visible instead of masking it with `execCommand`.
   */
  allowSecureLegacyFallback?: boolean
}

/**
 * Copies text using the modern API when available. Legacy copying is only used
 * on HTTP/insecure pages: a failed secure-context write is a real permission
 * error and must not be reported as a success by `execCommand`.
 */
export function copyText(
  text: string,
  { fallbackFocusTarget, allowSecureLegacyFallback = false }: CopyTextOptions = {},
): Promise<boolean> {
  const writeText = typeof navigator === "undefined" ? undefined : navigator.clipboard?.writeText
  if (typeof window !== "undefined" && window.isSecureContext) {
    if (!writeText) return Promise.resolve(allowSecureLegacyFallback ? copyTextWithLegacyApi(text, fallbackFocusTarget) : false)
    return writeText.call(navigator.clipboard, text).then(
      () => true,
      () => allowSecureLegacyFallback ? copyTextWithLegacyApi(text, fallbackFocusTarget) : false,
    )
  }
  if (writeText) {
    return writeText.call(navigator.clipboard, text).then(
      () => true,
      () => copyTextWithLegacyApi(text, fallbackFocusTarget),
    )
  }
  return Promise.resolve(copyTextWithLegacyApi(text, fallbackFocusTarget))
}

function copyTextWithLegacyApi(text: string, fallbackFocusTarget?: HTMLElement | null): boolean {
  if (typeof document === "undefined" || !document.body) return false
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  let copied = false
  try {
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    copied = document.execCommand?.("copy") === true
  } catch {
    // An unavailable or denied legacy clipboard path has no further fallback.
  } finally {
    textarea.remove()
    if (fallbackFocusTarget?.isConnected) fallbackFocusTarget.focus()
  }
  return copied
}
