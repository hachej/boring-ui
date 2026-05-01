import { createRequire } from 'node:module'
import { expect, test } from './fixtures'

const require = createRequire(import.meta.url)
const axeScriptPath = require.resolve('axe-core/axe.min.js')

function formatViolations(
  violations: Array<{
    id: string
    impact?: string | null
    nodes: Array<{ target: string[] }>
  }>,
): string {
  if (violations.length === 0) {
    return 'none'
  }
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .flatMap((node) => node.target)
        .slice(0, 3)
        .join(', ')
      return `${violation.id} (${violation.impact ?? 'unknown'}) @ ${targets}`
    })
    .join('\n')
}

test.describe('accessibility', () => {
  test('chat panel has no serious/critical axe violations', async ({
    browserPage,
  }) => {
    await expect(browserPage.locator('[data-boring-agent]')).toBeVisible()

    await browserPage.addScriptTag({
      path: axeScriptPath,
    })

    const results = await browserPage.evaluate(async () => {
      const axeApi = (window as unknown as { axe?: { run(target: Element | Document): Promise<unknown> } }).axe
      if (!axeApi) {
        throw new Error('axe was not loaded')
      }
      const target = document.querySelector('[data-boring-agent]') ?? document
      return await axeApi.run(target)
    }) as {
      violations: Array<{
        id: string
        impact?: string | null
        nodes: Array<{ target: string[] }>
      }>
    }

    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    )

    expect(
      blocking,
      `serious/critical violations:\n${formatViolations(blocking)}`,
    ).toEqual([])
  })
})
