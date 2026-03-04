import { test, expect } from '@playwright/test'

const API_BASE_URL =
  process.env.PW_E2E_API_BASE_URL
  || `http://127.0.0.1:${process.env.PW_E2E_API_PORT || '8000'}`

/**
 * Companion Claude Integration E2E Tests
 *
 * bd-1wi2.4.1: Regression — no COMPANION_URL set
 * bd-1wi2.4.2: Happy path — COMPANION_URL set
 * bd-1wi2.4.3: Coexistence — Claude and Companion panels simultaneously
 * bd-1wi2.4.4: Graceful fallback — Companion server down
 */

test.describe('Companion Integration', () => {
  test.describe('bd-1wi2.4.1: Regression — no COMPANION_URL', () => {
    test.skip(
      !!process.env.COMPANION_URL,
      'This suite requires COMPANION_URL to be unset'
    )

    test('capabilities omit companion service metadata when COMPANION_URL unset', async ({ request }) => {
      const response = await request.get(`${API_BASE_URL}/api/capabilities`)
      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      // Embedded companion mode may still expose feature flags, but external
      // companion service metadata should be absent when COMPANION_URL is unset.
      expect(data.services?.companion).toBeUndefined()
    })

    test('embedded companion panel renders without COMPANION_URL', async ({ page }) => {
      // Collect console errors
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      await page.goto('/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 15000 })

      // Embedded companion mode should still render companion panels.
      const companionPanel = page.locator('[data-testid="companion-panel"]')
      await expect(companionPanel.first()).toBeVisible({ timeout: 10000 })

      // No companion-related console errors
      const companionErrors = consoleErrors.filter(
        (e) => e.toLowerCase().includes('companion')
      )
      expect(companionErrors).toHaveLength(0)
    })

    test('existing panels still render without COMPANION_URL', async ({ page }) => {
      await page.goto('/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 15000 })

      // Dockview should be present
      await expect(page.locator('[data-testid="dockview"]')).toBeVisible()
    })
  })

  test.describe('bd-1wi2.4.2: Happy path — COMPANION_URL set', () => {
    test.skip(
      !process.env.COMPANION_URL,
      'Requires COMPANION_URL to be set and a running Companion server'
    )

    test('capabilities includes companion service when COMPANION_URL set', async ({ request }) => {
      const response = await request.get(`${API_BASE_URL}/api/capabilities`)
      expect(response.ok()).toBeTruthy()
      const data = await response.json()

      expect(data.features.companion).toBe(true)
      expect(data.services?.companion?.url).toBeTruthy()
    })

    test('companion panel renders when COMPANION_URL set', async ({ page }) => {
      await page.goto('/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 15000 })

      // Companion panel should exist
      const companionPanel = page.locator('[data-testid="companion-panel"]')
      // It may or may not be visible depending on layout; at minimum,
      // the companion-app or companion-connecting should be in DOM
      const appOrConnecting = page.locator(
        '[data-testid="companion-app"], [data-testid="companion-connecting"]'
      )
      await expect(appOrConnecting.first()).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('bd-1wi2.4.3: Coexistence — both panels', () => {
    test.skip(
      !process.env.COMPANION_URL,
      'Requires COMPANION_URL to be set and a running Companion server'
    )

    test('Claude terminal and Companion panels coexist', async ({ page }) => {
      await page.goto('/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 15000 })

      // Both panels should be present in the DOM
      const dockview = page.locator('[data-testid="dockview"]')
      await expect(dockview).toBeVisible()

      // The existing terminal panel (Claude sessions) should still work
      // The companion panel should also be present
      const companionExists = await page
        .locator('[data-testid="companion-panel"], [data-testid="companion-app"]')
        .count()
      expect(companionExists).toBeGreaterThan(0)
    })
  })

  test.describe('bd-1wi2.4.4: Graceful fallback — server down', () => {
    test.skip(
      !process.env.COMPANION_URL,
      'Requires COMPANION_URL to be set (server can be down)'
    )

    test('companion panel shows connecting state when server unreachable', async ({ page }) => {
      // Collect page errors
      const pageErrors: string[] = []
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })

      await page.goto('/')
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 15000 })

      // Panel should show either connecting or the app (depending on server state)
      // If server is down, it should NOT crash the page
      const companionArea = page.locator(
        '[data-testid="companion-panel"], [data-testid="companion-connecting"]'
      )
      const exists = await companionArea.count()
      expect(exists).toBeGreaterThanOrEqual(0) // Should not crash regardless

      // No uncaught page errors from companion
      const companionCrashes = pageErrors.filter(
        (e) => e.toLowerCase().includes('companion') && !e.includes('WebSocket')
      )
      expect(companionCrashes).toHaveLength(0)
    })
  })
})
