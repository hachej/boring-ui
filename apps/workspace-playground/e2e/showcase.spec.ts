import { expect, test } from "@playwright/test"

/**
 * Regression for gh-1452: `?showcase=1` pre-seeded a client-side session id
 * (SHOWCASE_SESSION_ID) that never had a matching backend session, so the
 * chat pane's network hydrate always 404'd — a permanent "session was not
 * found" banner and a composer that never enabled. The fix boots a real
 * backend session before the chat panel renders, so the showcase route must
 * come up connected with a working composer.
 */

test.describe("workspace-playground showcase route", () => {
  test("boots a working session with no error banner and a live composer", async ({ page }) => {
    test.setTimeout(120_000)

    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))

    await page.goto("/?showcase=1")

    // Cold dev-server boot (first request ever, unbundled deps) can take a
    // while beyond the usual per-assertion timeout — give it real headroom
    // rather than flaking on a slow first compile.
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 }).catch(() => {
      throw new Error(`showcase chat panel did not render; page errors: ${pageErrors.join(" | ") || "none"}`)
    })

    await expect(page.getByText("session was not found")).toHaveCount(0)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })

    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    await expect(composer).toBeVisible()
    await expect(composer).toBeEnabled()

    const prompt = `showcase smoke ${Date.now()}`
    await composer.fill(prompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByLabel("Agent conversation").getByText(prompt)).toBeVisible()
    await expect(page.locator('[data-boring-agent-message-role="assistant"]').last()).toBeVisible({ timeout: 30_000 })
  })
})
