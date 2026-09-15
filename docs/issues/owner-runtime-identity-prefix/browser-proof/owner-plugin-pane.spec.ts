import { expect, test } from "@playwright/test"

const PREFIX = "/owners/alice/workspace"
const headers = { authorization: "Bearer pane-proof" }

test("instance bridge opens a granted plugin surface once over authenticated prefixed polling", async ({ page }) => {
  const commandRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/ui/commands/next")) {
      commandRequests.push(request.url())
      expect(request.headers().authorization).toBe(headers.authorization)
      expect(new URL(request.url()).searchParams.has("token")).toBe(false)
    }
  })

  await page.goto("/")
  await expect.poll(() => commandRequests.length).toBeGreaterThan(0)

  const unprefixed = await page.request.get("http://127.0.0.1:5470/api/v1/ui/commands/next?poll=true", { headers })
  expect(unprefixed.status()).toBe(404)
  const unauthenticated = await page.request.get(`${PREFIX}/api/v1/ui/commands/next?poll=true`)
  expect(unauthenticated.status()).toBe(401)

  const granted = await page.request.post(`${PREFIX}/proof/open`, {
    headers,
    data: { kind: "owner.runtime", target: "granted:quarterly-report" },
  })
  expect(granted.ok()).toBe(true)
  await expect(page.getByTestId("owner-pane")).toHaveText("Owner plugin pane: granted:quarterly-report")
  expect(await page.evaluate(() => window.paneMounts)).toBe(1)

  const unknown = await page.request.post(`${PREFIX}/proof/open`, {
    headers,
    data: { kind: "owner.unknown", target: "granted:no-resolver" },
  })
  expect(unknown.ok()).toBe(true)
  const ungranted = await page.request.post(`${PREFIX}/proof/open`, {
    headers,
    data: { kind: "owner.runtime", target: "denied:not-granted" },
  })
  expect(ungranted.ok()).toBe(true)
  await page.waitForTimeout(1_800)

  expect(await page.evaluate(() => window.paneMounts)).toBe(1)
  await expect(page.getByText("denied:not-granted")).toHaveCount(0)
  const stats = await page.request.get(`${PREFIX}/proof/stats`, { headers })
  expect(await stats.json()).toEqual({ postCount: 3 })

  // WorkspaceAgentFront owns the stream. Its ChatPanelHost receives
  // bridgeEndpoint=null, so chat rendering cannot establish a duplicate drain.
  expect(commandRequests.length).toBeGreaterThan(0)
  expect(commandRequests.every((url) => url.includes(`${PREFIX}/api/v1/ui/commands/next?poll=true`))).toBe(true)
  await page.screenshot({ path: "results/plugin-pane-open.png", fullPage: true })
})
