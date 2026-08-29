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

    // The scripted harness marks its deterministic final reply with
    // `PI_NATIVE_ASSISTANT_DONE:<agentTypeId>` (apps/workspace-playground/
    // src/server/testing/scriptedPiHarness.ts). Waiting on that marker
    // (rather than "any assistant message container") proves the turn
    // actually completed streaming, not just that a message_start landed —
    // the container renders before the final text does.
    const meta = await (await page.request.get("/api/v1/workspace/meta")).json() as { defaultAgentTypeId: string }
    const doneMarker = `PI_NATIVE_ASSISTANT_DONE:${meta.defaultAgentTypeId}`
    const conversation = page.getByLabel("Agent conversation")

    const prompt = `showcase smoke ${Date.now()}`
    await composer.fill(prompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(conversation.getByText(prompt)).toBeVisible()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText(doneMarker)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 15_000 })
    await expect(composer).toBeEnabled()
  })

  test("reuses the same backend session across a reload in the same tab", async ({ page }) => {
    test.setTimeout(120_000)

    await page.goto("/?showcase=1")
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const firstSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(firstSessionId).toBeTruthy()

    // Bounded-retention regression: a reload in the same tab must resume the
    // already-booted (still-empty) session rather than minting a new durable
    // one every time (gh-1458 review finding #3).
    await page.reload({ waitUntil: "domcontentloaded" })
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const secondSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(secondSessionId).toBe(firstSessionId)
  })

  test("switching to a decorative padding session materializes a real backend session", async ({ page }) => {
    test.setTimeout(120_000)

    // `sessions=3` pads the list with two client-only placeholder rows
    // (gh-1458 review finding #2) — selecting one must not hand the chat
    // pane an id that 404s the way the original SHOWCASE_SESSION_ID did.
    await page.goto("/?showcase=1&sessions=3")
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await chat.waitFor({ state: "visible", timeout: 40_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })

    const decorativeRow = page.locator('[data-boring-workspace-part="app-session-row"][data-boring-session-id="__showcase__-2"]')
    await decorativeRow.waitFor({ state: "visible", timeout: 10_000 })
    await decorativeRow.locator("button").first().click()

    await expect(page.getByText("session was not found")).toHaveCount(0)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeEnabled()

    const activeSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(activeSessionId).not.toBe("__showcase__-2")
  })
})
