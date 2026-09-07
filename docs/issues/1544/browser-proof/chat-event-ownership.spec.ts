import { expect, test } from '@playwright/test'

const expectedRejectedCount = Number(process.env.PROOF_EXPECTED_REJECTED_COUNT ?? '0')
const revisionLabel = process.env.PROOF_REVISION_LABEL ?? 'candidate'

test('stale and contradictory terminals cannot falsely complete; valid next turn completes once', async ({ page }, testInfo) => {
  await page.goto('/')
  const composer = page.getByLabel('Agent prompt')
  const count = page.getByTestId('completion-count')
  const phase = page.getByTestId('phase')

  await expect(composer).toBeVisible()
  await expect(page.locator('[data-boring-agent-part="chat"]')).toHaveAttribute('data-pi-chat-connection', 'connected')
  await composer.fill('Verify terminal event ownership')
  await page.getByRole('button', { name: 'Submit' }).click()

  await expect(phase).toContainText('stale terminal rejected')
  await expect(count).toHaveText(String(expectedRejectedCount >= 1 ? 1 : 0))
  await expect(phase).toContainText('contradictory terminal rejected')
  await expect(count).toHaveText(String(expectedRejectedCount))
  await expect(phase).toContainText('valid next turn completed')
  await expect(count).toHaveText(String(expectedRejectedCount + 1))

  await page.screenshot({ path: testInfo.outputPath(`${revisionLabel}-final.png`), fullPage: true })
  await testInfo.attach('assertions.json', {
    body: Buffer.from(JSON.stringify({
      revisionLabel,
      viewport: testInfo.project.use.viewport,
      staleTerminalCallbacks: expectedRejectedCount >= 1 ? 1 : 0,
      callbacksAfterRejectedTerminals: expectedRejectedCount,
      callbacksAfterValidNextTurn: expectedRejectedCount + 1,
    }, null, 2)),
    contentType: 'application/json',
  })
})
