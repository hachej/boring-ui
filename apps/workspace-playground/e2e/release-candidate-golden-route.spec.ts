import { expect, test } from "@playwright/test"
import { assertReleaseCandidateAgentCss } from "../src/release-candidate-css"

const agentDistCssPath = "/packages/agent/dist/front/styles.css"

function isAgentDistStylesheet(url: string): boolean {
  return decodeURIComponent(new URL(url).pathname).replaceAll("\\", "/").includes(agentDistCssPath)
}

test("boots built dist and completes one addressed Alpha send", async ({ page }) => {
  test.setTimeout(120_000)
  expect(process.env.BORING_PLAYGROUND_DIST_ONLY, "RC smoke requires explicit dist-only mode").toBe("1")

  const cssFault = process.env.BORING_RC_BREAK_CSS
  if (cssFault === "small" || cssFault === "mime") {
    await page.route(`**${agentDistCssPath}*`, async (route) => {
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
    await page.route("**/api/v1/agents/alpha/sessions/*/prompt", async (route) => {
      if (breakFirstSend && route.request().method() === "POST") {
        breakFirstSend = false
        return await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "RC_EXPECTED_FIRST_SEND_FAILURE" } }),
        })
      }
      await route.continue()
    })
  }

  await page.goto("/?fresh=1")
  const stylesheetHref = await page.locator('link[data-boring-agent-stylesheet="package-import"]').getAttribute("href")
  expect(stylesheetHref).toBeTruthy()
  expect(isAgentDistStylesheet(new URL(stylesheetHref!, page.url()).href)).toBe(true)
  const cssReload = page.waitForResponse((response) => (
    response.request().resourceType() === "stylesheet" && response.url().includes("rc-proof=")
  ))
  await page.locator('link[data-boring-agent-stylesheet="package-import"]').evaluate((link: HTMLLinkElement) => {
    link.href = `${link.href}${link.href.includes("?") ? "&" : "?"}rc-proof=${Date.now()}`
  })
  const cssResponse = await cssReload
  const cssBody = await cssResponse.body()
  assertReleaseCandidateAgentCss(
    cssResponse.url(),
    cssResponse.headers()["content-type"],
    cssBody.byteLength,
  )
  await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "New chat with Alpha", exact: true })).toBeVisible()

  const chat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
  await expect(chat).toHaveAttribute("data-pi-chat-session-id", /.+/, { timeout: 60_000 })
  const sessionId = await chat.getAttribute("data-pi-chat-session-id")
  expect(sessionId).toBeTruthy()

  const promptResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === "POST"
      && url.pathname === `/api/v1/agents/alpha/sessions/${sessionId}/prompt`
  })
  await chat.getByRole("textbox", { name: "Agent prompt" }).fill(`release candidate ${Date.now()}`)
  await chat.locator('[data-boring-agent-part="composer-submit"]').click()
  expect((await promptResponse).status(), "first send must use the addressed prompt route").toBe(202)
  await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
  await expect(chat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true }).last()).toBeVisible({ timeout: 30_000 })
})
