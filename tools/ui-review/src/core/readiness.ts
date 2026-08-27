type ReloadablePage = {
  reload(options: { waitUntil: "domcontentloaded" }): Promise<unknown>
}

export type UiReviewReadinessDiagnostic = {
  retryUsed: boolean
  firstError: string | null
}

const RETRY_MARKER = "UI_REVIEW_READINESS_DISCOVERY_RETRY"

function errorSummary(error: unknown): string {
  const summary = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return summary.replace(/\s+/g, " ").slice(0, 1_000) || "unknown discovery failure"
}

/** Retry only one-shot discovery; all downstream readiness contracts run exactly once. */
export async function runUiReviewReadinessWithReload<TPage extends ReloadablePage>(
  page: TPage,
  timeoutMs: number,
  discover: (page: TPage, timeoutMs: number) => Promise<void>,
  assertReady: (page: TPage, timeoutMs: number) => Promise<void>,
): Promise<UiReviewReadinessDiagnostic> {
  let diagnostic: UiReviewReadinessDiagnostic = { retryUsed: false, firstError: null }
  try {
    await discover(page, Math.max(1, Math.floor(timeoutMs / 2)))
  } catch (error) {
    diagnostic = { retryUsed: true, firstError: errorSummary(error) }
    console.warn(`${RETRY_MARKER}: ${diagnostic.firstError}`)
    await page.reload({ waitUntil: "domcontentloaded" })
    await discover(page, timeoutMs)
  }
  await assertReady(page, timeoutMs)
  return diagnostic
}
