import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

const json = (value: unknown) => JSON.stringify(value)

const fulfillJson = (route: Route, status: number, body: unknown) => {
  route.fulfill({
    status,
    contentType: 'application/json',
    body: json(body),
  })
}

const waitForUserMenuButton = async (page: Page) => {
  const button = page.locator('[aria-label="User menu"]').first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await button.waitFor({ state: 'visible', timeout: 10000 })
      return button
    } catch (error) {
      if (attempt === 2) throw error
      await page.reload()
    }
  }
  return button
}

test.describe('Canonical Transport Regression', () => {
  test('user menu bootstrap + logout use canonical control-plane routes', async ({ page }) => {
    const apiPaths = new Set<string>()

    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/') || url.pathname === '/auth/logout') {
        apiPaths.add(url.pathname)
      }
    })

    await page.route('**/auth/logout', (route) => {
      route.fulfill({
        status: 204,
        body: '',
      })
    })
    await page.route('**/api/v1/me', (route) =>
      fulfillJson(route, 200, { email: 'john@example.com' }),
    )
    await page.route('**/api/v1/workspaces', (route) =>
      fulfillJson(route, 200, { workspaces: [{ id: 'ws-1', name: 'One' }] }),
    )

    await page.goto('/')
    const userMenuButton = await waitForUserMenuButton(page)

    await expect.poll(() => apiPaths.has('/api/v1/me')).toBe(true)
    await expect.poll(() => apiPaths.has('/api/v1/workspaces')).toBe(true)
    expect(Array.from(apiPaths)).not.toContain('/api/me')
    expect(Array.from(apiPaths)).not.toContain('/api/workspaces')

    const logoutRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/auth/logout',
    )
    await userMenuButton.click()
    const logoutMenuItem = page.getByRole('menuitem', { name: 'Logout' })
    await expect(logoutMenuItem).toBeEnabled()
    await logoutMenuItem.click()
    await logoutRequest
  })
})
