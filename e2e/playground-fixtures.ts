import { test as loggingTest, type LoggingFixture } from "./fixtures/loggingHarness"
import { expect, type Page } from "@playwright/test"
import { startPlayground, type PlaygroundServer } from "./helpers/playground"

interface PlaygroundFixtures {
  pg: Page
  logging: LoggingFixture
}

interface PlaygroundWorkerFixtures {
  playground: PlaygroundServer
}

export const test = loggingTest.extend<PlaygroundFixtures, PlaygroundWorkerFixtures>({
  playground: [
    async ({}, use) => {
      const server = await startPlayground()
      try {
        await use(server)
      } finally {
        await server.stop()
      }
    },
    { scope: "worker" },
  ],
  pg: async ({ page, playground }, use) => {
    await page.goto(playground.url, { waitUntil: "networkidle" })
    await page.waitForSelector(".dv-shell", { timeout: 15_000 })
    await use(page)
  },
})

export { expect }
