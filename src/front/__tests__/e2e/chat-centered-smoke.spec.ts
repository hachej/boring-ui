import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Chat-centered shell smoke tests.
 *
 * Validates Phase 1-2 of the chat interface cleanup:
 * - Shell renders (NavRail, ChatStage, ChatComposer)
 * - Dev banner shows correct mode
 * - Thinking toggle works (frontend mode only)
 * - Model selector visible (frontend mode only)
 * - Agent mode switching via URL param
 * - Composer input + send button behavior
 * - API key prompt appears on agent error (frontend mode)
 *
 * These tests do NOT require an API key or running backend agent.
 * They run against the Vite dev server.
 */

const DEV_SERVER = process.env.PW_CHAT_SMOKE_URL || ''
const SKIP_REASON = 'Set PW_CHAT_SMOKE_URL (e.g. http://100.68.199.114:5173) to run chat-centered smoke tests'

const gotoShell = async (page: Page, params: Record<string, string> = {}) => {
  const base = DEV_SERVER || '/'
  const query = new URLSearchParams({ shell: 'chat-centered', ...params }).toString()
  const url = `${base}?${query}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
}

test.describe('Chat-centered shell smoke', () => {
  test.skip(!DEV_SERVER, SKIP_REASON)

  test('renders NavRail, ChatStage, and ChatComposer', async ({ page }) => {
    await gotoShell(page)

    // NavRail
    await expect(page.locator('[data-testid="nav-rail"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-testid="nav-rail-brand"]')).toBeVisible()
    await expect(page.locator('[data-testid="nav-rail-new-chat"]')).toBeVisible()

    // ChatStage
    await expect(page.locator('.vc-stage')).toBeVisible({ timeout: 10000 })

    // ChatComposer
    await expect(page.locator('.vc-composer-input')).toBeVisible()
    await expect(page.locator('.vc-composer-input')).toHaveAttribute('placeholder', 'Ask a question...')
  })

  test('dev banner contains shell and agent mode info', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'frontend' })

    const banner = page.locator('.dev-mode-banner')
    await expect(banner).toHaveCount(1, { timeout: 10000 })
    await expect(banner).toContainText('chat-centered')
    await expect(banner).toContainText('agent:frontend')
  })

  test('dev banner reflects backend agent mode', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'backend' })

    const banner = page.locator('.dev-mode-banner')
    await expect(banner).toHaveCount(1, { timeout: 10000 })
    await expect(banner).toContainText('agent:backend')
  })

  test('thinking toggle visible in frontend mode and cycles levels', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'frontend' })

    const toggle = page.locator('[data-testid="thinking-toggle"]')
    await expect(toggle).toBeVisible({ timeout: 10000 })

    // Initially off — no label text
    await expect(toggle.locator('.vc-thinking-label')).toHaveCount(0)
    await expect(toggle).not.toHaveClass(/active/)

    // Click → low
    await toggle.click()
    await expect(toggle).toHaveClass(/active/)
    await expect(toggle.locator('.vc-thinking-label')).toHaveText('low')

    // Click → high
    await toggle.click()
    await expect(toggle.locator('.vc-thinking-label')).toHaveText('high')

    // Click → off
    await toggle.click()
    await expect(toggle).not.toHaveClass(/active/)
    await expect(toggle.locator('.vc-thinking-label')).toHaveCount(0)
  })

  test('thinking toggle renders in backend mode too', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'backend' })

    await expect(page.locator('.vc-composer-input')).toBeVisible({ timeout: 10000 })

    // Controls are visible in all modes — server can respect preferences
    await expect(page.locator('[data-testid="thinking-toggle"]')).toBeVisible()
  })

  test('model selector visible in frontend mode', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'frontend' })

    const selector = page.locator('[data-testid="model-selector"]')
    await expect(selector).toBeVisible({ timeout: 10000 })

    // Click opens menu
    await selector.click()
    const menu = page.locator('[data-testid="model-menu"]')
    await expect(menu).toBeVisible()

    // Menu has model options
    const options = menu.locator('.vc-model-option')
    const count = await options.count()
    expect(count).toBeGreaterThan(0)

    // Click outside closes menu
    await page.locator('.vc-stage').click()
    await expect(menu).not.toBeVisible()
  })

  test('model selector renders in backend mode too', async ({ page }) => {
    await gotoShell(page, { agent_mode: 'backend' })

    await expect(page.locator('.vc-composer-input')).toBeVisible({ timeout: 10000 })

    // Controls are visible in all modes — server can respect preferences
    await expect(page.locator('[data-testid="model-selector"]')).toBeVisible()
  })

  test('composer send button enables when text is entered', async ({ page }) => {
    await gotoShell(page)

    const input = page.locator('.vc-composer-input')
    const sendBtn = page.locator('[data-testid="chat-send-btn"]')

    await expect(input).toBeVisible({ timeout: 10000 })

    // Send disabled when empty
    await expect(sendBtn).toBeDisabled()

    // Type text → send enabled
    await input.fill('hello')
    await expect(sendBtn).toBeEnabled()

    // Clear → send disabled again
    await input.fill('')
    await expect(sendBtn).toBeDisabled()
  })

  test('session drawer opens and closes via NavRail', async ({ page }) => {
    await gotoShell(page)

    await expect(page.locator('[data-testid="nav-rail"]')).toBeVisible({ timeout: 10000 })

    // Click sessions button
    const sessionsBtn = page.locator('[data-testid="nav-rail-history"]')
    await sessionsBtn.click()

    // Drawer appears
    const drawer = page.locator('[data-testid="browse-drawer"]')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Click again to close
    await sessionsBtn.click()
    await expect(drawer).not.toBeVisible()
  })

  test('new chat button creates a fresh session', async ({ page }) => {
    await gotoShell(page)

    await expect(page.locator('[data-testid="nav-rail-new-chat"]')).toBeVisible({ timeout: 10000 })

    // Click new chat
    await page.locator('[data-testid="nav-rail-new-chat"]').click()

    // Stage should show empty state
    await expect(page.locator('.vc-stage-empty')).toBeVisible({ timeout: 5000 })
  })

  test('empty state shows welcome message', async ({ page }) => {
    await gotoShell(page)

    await expect(page.locator('.vc-stage-empty')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.vc-stage-empty-title')).toContainText('What can I help with')
  })

  test('keyboard shortcut Cmd+1 toggles session drawer', async ({ page }) => {
    await gotoShell(page)

    await expect(page.locator('.vc-composer-input')).toBeVisible({ timeout: 10000 })

    // Cmd+1 opens drawer
    await page.keyboard.press('Meta+1')
    await expect(page.locator('[data-testid="browse-drawer"]')).toBeVisible({ timeout: 5000 })

    // Cmd+1 closes drawer
    await page.keyboard.press('Meta+1')
    await expect(page.locator('[data-testid="browse-drawer"]')).not.toBeVisible()
  })
})
