import { expect, test } from './fixtures'

test('fixtures boot CLI backend, seed workspace, and load browser page', async ({
  backend,
  workspace,
  browserPage,
}) => {
  const health = await browserPage.request.get(`${backend.apiUrl}/health`)
  expect(health.ok()).toBe(true)

  const healthBody = (await health.json()) as { version?: string }
  expect(healthBody.version).toContain('@boring/agent@')

  const readSeeded = await browserPage.request.get(
    `${backend.apiUrl}/api/v1/files?path=README.md`,
  )
  expect(readSeeded.ok()).toBe(true)

  const seededBody = (await readSeeded.json()) as { content?: string }
  expect(seededBody.content).toContain('seeded by Playwright fixtures')
  expect(workspace.root).toContain('boring-agent-e2e-')

  await expect(browserPage.locator('body')).toBeVisible()
})
