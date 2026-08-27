type CaptureFreezeHandle = {
  evaluate(callback: (style: HTMLElement) => void): Promise<unknown>
}

type StableCapturePage = {
  addStyleTag(options: { content: string }): Promise<CaptureFreezeHandle>
  evaluate(callback: () => Promise<void>): Promise<unknown>
}

const CAPTURE_FREEZE_CSS = `
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}
`

/** Keep screenshots and DOM hard-gate measurements on the same settled frame. */
export async function withStableBrowserCapture<T>(
  page: StableCapturePage,
  capture: () => Promise<T>,
): Promise<T> {
  const freeze = await page.addStyleTag({ content: CAPTURE_FREEZE_CSS })
  try {
    await page.evaluate(async () => {
      if ("fonts" in document) await document.fonts.ready
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
    })
    return await capture()
  } finally {
    await freeze.evaluate((style) => { style.remove() }).catch(() => undefined)
  }
}
