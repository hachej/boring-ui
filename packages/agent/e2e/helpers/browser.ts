import type { Page } from '@playwright/test'

const NAVIGATION_ATTEMPTS = 5
const NAVIGATION_RETRY_DELAY_MS = 250
const RETRYABLE_NAVIGATION_ERRORS = [
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ECONNRESET',
  'ECONNREFUSED',
] as const

export async function navigateBrowserToBackend(
  page: Page,
  backendUrl: string,
): Promise<void> {
  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.goto(backendUrl, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      if (attempt === NAVIGATION_ATTEMPTS || !isRetryableNavigationError(error)) {
        throw error
      }
      await page.waitForTimeout(NAVIGATION_RETRY_DELAY_MS)
    }
  }
}

function isRetryableNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return RETRYABLE_NAVIGATION_ERRORS.some((needle) => message.includes(needle))
}
