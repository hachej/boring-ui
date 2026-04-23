import type { Page } from '@playwright/test'

export async function navigateBrowserToBackend(
  page: Page,
  backendUrl: string,
): Promise<void> {
  await page.goto(backendUrl, { waitUntil: 'domcontentloaded' })
}
