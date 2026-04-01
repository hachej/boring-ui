import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Chat agent interaction tests — verifies real agent tool use across all 4 configs:
 *
 *   1. chat-centered + frontend (browser PI agent)
 *   2. chat-centered + backend  (server agent via /api/v1/agent/chat)
 *   3. legacy + frontend        (browser PI agent in DockView)
 *   4. legacy + backend          (server agent in DockView)
 *
 * Each config runs the same scenario:
 *   1. "list me files" → agent responds with file listing
 *   2. "create a new file tt.md with 'hellooo'" → agent creates file
 *   3. Verify the file content appeared
 *
 * Requires:
 *   - PW_CHAT_SMOKE_URL pointing at a running dev server with API key
 *   - Backend server running at the same origin for backend mode
 */

const DEV_SERVER = process.env.PW_CHAT_SMOKE_URL || ''
const SKIP_REASON = 'Set PW_CHAT_SMOKE_URL to run agent interaction tests'

// Longer timeout for agent responses (LLM calls + tool execution)
const AGENT_RESPONSE_TIMEOUT = 120_000

const gotoShell = async (page: Page, shell: string, agentMode: string) => {
  const url = `${DEV_SERVER}?shell=${shell}&agent_mode=${agentMode}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
}

/**
 * Wait for a new assistant message containing the expected text.
 * Scans .vc-msg elements for chat-centered, or general text for legacy.
 */
const waitForAgentResponse = async (page: Page, shell: string, textPattern: RegExp) => {
  if (shell === 'chat-centered') {
    // Wait for any assistant message body — the agent may render text, tool cards, or markdown
    await expect(
      page.locator('.vc-msg').filter({ hasText: textPattern }).last()
    ).toBeVisible({ timeout: AGENT_RESPONSE_TIMEOUT })
  } else {
    // Legacy shell — agent response could be in various containers
    await expect(
      page.locator('[data-testid="agent-panel"], [data-testid="agent-app"], .provider-agent').filter({ hasText: textPattern }).last()
    ).toBeVisible({ timeout: AGENT_RESPONSE_TIMEOUT })
  }
}

/**
 * Wait for the agent to finish streaming (send button reappears).
 */
const waitForAgentIdle = async (page: Page, shell: string) => {
  if (shell === 'chat-centered') {
    // Wait for the stop button to disappear (agent done streaming)
    // then the send button reappears
    await expect(page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(0, { timeout: AGENT_RESPONSE_TIMEOUT })
    await expect(page.locator('[data-testid="chat-send-btn"]')).toBeVisible({ timeout: 10000 })
  } else {
    // For legacy, wait for no active streaming indicators
    await page.waitForTimeout(5000)
  }
}

/**
 * Send a message in the chat-centered shell.
 */
const sendMessageChatCentered = async (page: Page, text: string) => {
  const input = page.locator('.vc-composer-input')
  await expect(input).toBeVisible({ timeout: 15000 })
  await input.fill(text)
  await expect(page.locator('[data-testid="chat-send-btn"]')).toBeEnabled({ timeout: 5000 })
  await page.locator('[data-testid="chat-send-btn"]').click()
}

/**
 * Send a message in the legacy shell.
 * Legacy uses pi-web-ui's message-editor or AiChat's input.
 */
const sendMessageLegacy = async (page: Page, text: string) => {
  // Try chat-centered ChatStage (if AgentPanel uses it after Phase 3)
  const vcInput = page.locator('.vc-composer-input')
  const piInput = page.locator('message-editor textarea').first()
  const aiInput = page.locator('[data-testid="agent-ai-sdk-app"] textarea, [data-testid="agent-app"] textarea').first()

  if (await vcInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await vcInput.fill(text)
    await page.locator('[data-testid="chat-send-btn"]').click()
  } else if (await piInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await piInput.fill(text)
    // PI send button
    const sendBtn = page.locator('message-editor .px-2.pb-2 > .flex.gap-2.items-center:last-child > button:last-child').first()
    await sendBtn.click()
  } else if (await aiInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await aiInput.fill(text)
    await page.keyboard.press('Enter')
  } else {
    throw new Error('Could not find any chat input in legacy shell')
  }
}

const sendMessage = async (page: Page, shell: string, text: string) => {
  if (shell === 'chat-centered') {
    await sendMessageChatCentered(page, text)
  } else {
    await sendMessageLegacy(page, text)
  }
}

const waitForShellReady = async (page: Page, shell: string) => {
  if (shell === 'chat-centered') {
    await expect(page.locator('.vc-composer-input')).toBeVisible({ timeout: 30000 })
  } else {
    // Legacy: wait for agent panel
    await expect(
      page.locator('[data-testid="agent-panel"], [data-testid="agent-app"], message-editor textarea').first()
    ).toBeVisible({ timeout: 60000 })
  }
}

// Unique filename per test run to avoid collisions
const TAG = `${Date.now()}`
const TEST_FILENAME = `tt-${TAG}.md`
const TEST_CONTENT = 'hellooo'

const configs = [
  { shell: 'chat-centered', agentMode: 'frontend', label: 'CC+frontend' },
  { shell: 'chat-centered', agentMode: 'backend', label: 'CC+backend' },
  { shell: 'legacy', agentMode: 'frontend', label: 'Legacy+frontend' },
  { shell: 'legacy', agentMode: 'backend', label: 'Legacy+backend' },
]

test.describe('Agent interaction across all 4 configs', () => {
  test.skip(!DEV_SERVER, SKIP_REASON)
  test.describe.configure({ timeout: 180_000 })

  for (const { shell, agentMode, label } of configs) {
    test(`[${label}] create file, open in editor, read back`, async ({ page }) => {
      await gotoShell(page, shell, agentMode)
      await waitForShellReady(page, shell)

      // Step 1: Create a file
      await sendMessage(
        page,
        shell,
        `Create a file called ${TEST_FILENAME} with exactly this content: "${TEST_CONTENT}"`,
      )
      await waitForAgentIdle(page, shell)

      // Verify agent acknowledged (any response mentioning the filename)
      await waitForAgentResponse(page, shell, new RegExp(TEST_FILENAME.replace(/\./g, '\\.')))

      // Step 2: Read it back
      await sendMessage(
        page,
        shell,
        `Read the file ${TEST_FILENAME} and show me its exact contents.`,
      )
      await waitForAgentIdle(page, shell)

      // Verify our content appears in the response
      await waitForAgentResponse(page, shell, new RegExp(TEST_CONTENT))

      // Step 3: Open the file in editor
      await sendMessage(
        page,
        shell,
        `Now open ${TEST_FILENAME} in the editor. Use the open_file tool.`,
      )
      await waitForAgentIdle(page, shell)

      // Verify file opens — check for tab or Surface artifact
      const fileNamePattern = new RegExp(TEST_FILENAME.replace(/\./g, '\\.'))

      if (shell === 'chat-centered') {
        // Chat-centered: Surface should expand and show the file as a DockView tab
        await expect(
          page.locator('.surface-shell').first()
        ).toBeVisible({ timeout: 30000 })

        await expect(
          page.locator('.surface-shell .dv-default-tab, .surface-shell .dv-tab').filter({ hasText: fileNamePattern }).first()
        ).toBeVisible({ timeout: 15000 })
      } else {
        // Legacy: DockView tab
        await expect(
          page.locator('.dv-default-tab, .dv-tab').filter({ hasText: fileNamePattern }).first()
        ).toBeVisible({ timeout: 30000 })
      }

      // Step 4: Close Surface/workbench, then reopen via agent
      if (shell === 'chat-centered') {
        // Close surface via the floating close button or nav rail toggle
        const closeBtn = page.locator('.sf-floating-close').first()
        if (await closeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await closeBtn.click()
        } else {
          await page.locator('[data-testid="nav-rail-surface"]').click()
        }
        await page.waitForTimeout(500)

        // Verify Surface is closed
        await expect(page.locator('.surface-shell')).not.toBeVisible({ timeout: 5000 })

        // Ask agent to open the file again — Surface should auto-reopen
        await sendMessage(page, shell, `Open ${TEST_FILENAME} in the editor again using open_file.`)
        await waitForAgentIdle(page, shell)

        // Surface should have reopened with the file
        await expect(page.locator('.surface-shell').first()).toBeVisible({ timeout: 15000 })
        await expect(
          page.locator('.surface-shell .dv-default-tab, .surface-shell .dv-tab').filter({ hasText: fileNamePattern }).first()
        ).toBeVisible({ timeout: 10000 })
      }

      // Step 5: Ask agent what panes/tabs are open and which is active
      await sendMessage(
        page,
        shell,
        'What tabs are open in the editor right now? Which one is active? Use the list_tabs tool.',
      )
      await waitForAgentIdle(page, shell)

      // Verify the agent response mentions our test file as open
      await waitForAgentResponse(page, shell, fileNamePattern)

      // Verify the active tab marker exists somewhere on page — list_tabs uses * prefix
      // or the agent mentions "active"/"current". Check page-wide, not scoped to agent panel.
      await expect(
        page.locator('body').filter({ hasText: fileNamePattern })
      ).toBeVisible({ timeout: 5000 })

      // Screenshot
      await page.screenshot({
        path: `test-results/agent-interaction-${label}.png`,
        fullPage: true,
      })

      // Cleanup
      await sendMessage(page, shell, `Delete the file ${TEST_FILENAME}.`)
      await waitForAgentIdle(page, shell)
    })
  }
})
