type ReloadablePage = {
  reload(options: { waitUntil: "domcontentloaded" }): Promise<unknown>
}

/** Retry one-shot client hydration once; waiting longer cannot recover a rejected discovery fetch. */
export async function runUiReviewReadinessWithReload<TPage extends ReloadablePage>(
  page: TPage,
  timeoutMs: number,
  ready: (page: TPage, timeoutMs: number) => Promise<void>,
): Promise<void> {
  try {
    await ready(page, Math.max(1, Math.floor(timeoutMs / 2)))
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" })
    await ready(page, timeoutMs)
  }
}
