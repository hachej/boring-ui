import { expect, test } from "@playwright/test"

declare global {
  interface Window {
    paneMounts?: number
    emitProofChatDisplayEvent?: () => void
  }
}

const PREFIX = "/owners/alice/workspace"
const headers = { authorization: "Bearer pane-proof" }

test("instance bridge opens a granted plugin surface once over authenticated prefixed polling", async ({ page }, testInfo) => {
  const commandRequests: string[] = []
  const deliveredCommandSeqs: number[] = []
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/ui/commands/next")) {
      commandRequests.push(request.url())
      expect(request.headers().authorization).toBe(headers.authorization)
      expect(new URL(request.url()).searchParams.has("token")).toBe(false)
    }
  })
  page.on("response", async (response) => {
    if (!response.url().includes("/api/v1/ui/commands/next?poll=true") || !response.ok()) return
    const batch = await response.json().catch(() => []) as Array<{ seq?: unknown }>
    deliveredCommandSeqs.push(...batch.flatMap(({ seq }) => typeof seq === "number" ? [seq] : []))
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
  const grantedBody = await granted.json() as { result: { seq: number } }
  const grantedSeq = grantedBody.result.seq
  await expect(page.getByTestId("owner-pane")).toHaveText("Owner plugin pane: granted:quarterly-report")
  expect(await page.evaluate(() => window.paneMounts)).toBe(1)
  await expect.poll(() => deliveredCommandSeqs).toEqual([grantedSeq])

  // A real chat-display event carries a command-shaped decoy. It must remain
  // display data and must not enter the UI command dispatcher.
  await page.evaluate(() => window.emitProofChatDisplayEvent?.())
  await page.waitForTimeout(300)
  expect(await deliveredCommandSeqs).toEqual([grantedSeq])
  expect(await page.getByText("granted:must-not-open").count()).toBe(0)

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
  const transport = await stats.json() as { postCount: number; drainCount: number; deliveredSeqs: number[] }
  expect(transport.postCount).toBe(3)
  expect(transport.drainCount).toBeGreaterThan(0)
  expect(transport.deliveredSeqs.filter((seq) => seq === grantedSeq)).toHaveLength(1)
  expect(new Set(transport.deliveredSeqs).size).toBe(transport.deliveredSeqs.length)
  expect(deliveredCommandSeqs).toEqual(transport.deliveredSeqs)

  expect(commandRequests.length).toBeGreaterThan(0)
  expect(commandRequests.every((url) => url.includes(`${PREFIX}/api/v1/ui/commands/next?poll=true`))).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("plugin-pane-open.png"), fullPage: true })
})
