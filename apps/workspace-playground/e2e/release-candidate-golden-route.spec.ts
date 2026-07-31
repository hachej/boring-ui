import { expect, test } from "@playwright/test"
import { assertReleaseCandidateAgentCss } from "../src/release-candidate-css"

const agentDistCssPath = "/packages/agent/dist/front/styles.css"

function isAgentDistStylesheet(url: string): boolean {
  return decodeURIComponent(new URL(url).pathname).replaceAll("\\", "/").includes(agentDistCssPath)
}

test("boots built dist and completes one Alpha first send", async ({ page }) => {
  test.setTimeout(120_000)
  expect(process.env.BORING_PLAYGROUND_DIST_ONLY, "RC smoke requires explicit dist-only mode").toBe("1")

  const cssFault = process.env.BORING_RC_BREAK_CSS
  if (cssFault === "small" || cssFault === "mime") {
    await page.route(`**${agentDistCssPath}*`, async (route) => {
      if (route.request().resourceType() !== "stylesheet") {
        await route.continue()
        return
      }
      const response = await route.fetch()
      const body = cssFault === "small" ? Buffer.from("/* deliberately small RC fixture */") : await response.body()
      await route.fulfill({
        response,
        body,
        headers: {
          ...response.headers(),
          "content-type": cssFault === "mime" ? "application/javascript" : "text/css; charset=utf-8",
        },
      })
    })
  }

  let breakFirstSend = process.env.BORING_RC_BREAK_FIRST_SEND === "1"
  if (breakFirstSend) {
    await page.route("**/api/v1/agents/alpha/sessions", async (route) => {
      if (breakFirstSend && route.request().method() === "POST") {
        breakFirstSend = false
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "RC_EXPECTED_FIRST_SEND_FAILURE" } }),
        })
        return
      }
      await route.continue()
    })
  }

  const agentCssResponse = page.waitForResponse(
    (response) => response.request().resourceType() === "stylesheet"
      && isAgentDistStylesheet(response.url()),
    { timeout: 30_000 },
  )
  await page.goto("/?fresh=1")
  const cssResponse = await agentCssResponse
  const cssBody = await cssResponse.body()
  console.log(
    `[release-candidate] Agent stylesheet ${cssResponse.url()} ${cssResponse.headers()["content-type"] ?? "missing"} ${cssBody.byteLength} bytes`,
  )
  assertReleaseCandidateAgentCss(
    cssResponse.url(),
    cssResponse.headers()["content-type"],
    cssBody.byteLength,
  )
  await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "New chat with Alpha", exact: true }).click()
  const chat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
  await expect(chat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
  const localSessionId = await chat.getAttribute("data-pi-chat-session-id")

  const created = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === "POST"
      && url.pathname === "/api/v1/agents/alpha/sessions"
  })
  await chat.getByRole("textbox", { name: "Agent prompt" }).fill(`release candidate ${Date.now()}`)
  await chat.locator('[data-boring-agent-part="composer-submit"]').click()
  expect((await created).status(), "first send must create an addressed session").toBe(201)

  let adoptedSessionId = ""
  await expect.poll(async () => {
    adoptedSessionId = await chat.getAttribute("data-pi-chat-session-id") ?? ""
    return adoptedSessionId
  }, { timeout: 15_000 }).not.toBe(localSessionId)
  expect(adoptedSessionId).not.toMatch(/^local-/)
  await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
  await expect(chat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toBeVisible({ timeout: 30_000 })
})
