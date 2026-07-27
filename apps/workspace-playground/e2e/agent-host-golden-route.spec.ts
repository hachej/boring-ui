import { expect, test, type Page } from "@playwright/test"

const LEGACY_PI_CHAT_PATH = "/api/v1/agent/pi-chat/"

async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+KeyK")
  const palette = page.getByRole("dialog", { name: /command palette/i })
  await expect(palette).toBeVisible()
  await page.keyboard.type(`>${command}`)
  await page.getByRole("option", { name: new RegExp(command, "i") }).first().click()
  await expect(palette).toBeHidden()
}

test.describe("addressed Agent Host browser wire", () => {
  test("retains the golden operations across two agents and a mid-stream reload without legacy requests", async ({ page }) => {
    test.setTimeout(180_000)

    const forbiddenLegacyRequests: string[] = []
    const addressedRequests: Array<{ method: string; path: string }> = []
    const addressedResponses: Array<{ method: string; path: string; status: number }> = []
    let catalogRequests = 0
    await page.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (request.url().includes(LEGACY_PI_CHAT_PATH)) {
        forbiddenLegacyRequests.push(`${request.method()} ${url.pathname}`)
        await route.abort("blockedbyclient")
        return
      }
      await route.continue()
    })
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname === "/api/v1/agents") catalogRequests += 1
      if (url.pathname.startsWith("/api/v1/agents/")) {
        addressedRequests.push({ method: request.method(), path: url.pathname })
      }
    })
    page.on("response", (response) => {
      const url = new URL(response.url())
      if (url.pathname.startsWith("/api/v1/agents/")) {
        addressedResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        })
      }
    })
    const assertNoLegacyRequests = () => {
      expect(
        forbiddenLegacyRequests,
        `Addressed browser behavior must never request ${LEGACY_PI_CHAT_PATH}`,
      ).toEqual([])
    }

    await page.goto("/?fresh=1")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    const selector = page.getByRole("combobox", { name: "Agent" })
    await expect(selector).toHaveValue("alpha", { timeout: 10_000 })
    await expect(selector.locator("option")).toHaveText(["Alpha", "Beta"])

    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(chat).toHaveAttribute("data-agent-type-id", "alpha")
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })
    expect(catalogRequests).toBe(1)
    assertNoLegacyRequests()

    const workspaceMeta = await (await page.request.get("/api/v1/workspace/meta")).json() as { workspaceId: string }
    const workspaceHeaders = { "x-boring-workspace-id": workspaceMeta.workspaceId }
    await expect.poll(() => addressedRequests.filter(({ method, path }) => (
      method === "POST" && path === "/api/v1/agents/alpha/sessions"
    )).length, { timeout: 10_000 }).toBeGreaterThan(0)
    const initialAlphaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    await runCommand(page, "New Chat")
    let alphaSessionId: string | null = null
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      alphaSessionId = nextSessionId && nextSessionId !== initialAlphaSessionId ? nextSessionId : null
      return alphaSessionId
    }, { timeout: 10_000 }).not.toBeNull()
    expect(alphaSessionId).toBeTruthy()

    const goldenPrompt = `golden prompt ${Date.now()}`
    await composer.fill(goldenPrompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(goldenPrompt)).toBeVisible()

    const clearedFollowup = "golden queued then cleared"
    await composer.fill(clearedFollowup)
    await composer.press("Enter")
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText(clearedFollowup, { timeout: 10_000 })
    await page.getByRole("button", { name: "Edit queued follow-ups" }).click()
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)
    await expect(composer).toHaveValue(clearedFollowup)

    const continuedFollowup = "golden queued then continued"
    await composer.fill(continuedFollowup)
    await composer.press("Enter")
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText(continuedFollowup, { timeout: 10_000 })
    const interrupt = await page.request.post(`/api/v1/agents/alpha/sessions/${encodeURIComponent(alphaSessionId!)}/interrupt`, {
      headers: workspaceHeaders,
      data: {},
    })
    expect(interrupt.status(), await interrupt.text()).toBe(202)
    addressedResponses.push({
      method: "POST",
      path: `/api/v1/agents/alpha/sessions/${alphaSessionId}/interrupt`,
      status: interrupt.status(),
    })
    await expect(page.getByLabel("Agent conversation").getByText(continuedFollowup)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0, { timeout: 10_000 })
    const stop = await page.request.post(`/api/v1/agents/alpha/sessions/${encodeURIComponent(alphaSessionId!)}/stop`, {
      headers: workspaceHeaders,
      data: {},
    })
    expect(stop.status(), await stop.text()).toBe(202)
    addressedResponses.push({
      method: "POST",
      path: `/api/v1/agents/alpha/sessions/${alphaSessionId}/stop`,
      status: stop.status(),
    })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 10_000 })

    const alphaPrompt = `alpha mid-stream reload ${Date.now()}`
    await composer.fill(alphaPrompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(alphaPrompt)).toBeVisible()
    const alphaEventsBeforeReload = addressedRequests.filter(({ method, path }) => (
      method === "GET" && path === `/api/v1/agents/alpha/sessions/${alphaSessionId}/events`
    )).length
    expect(alphaEventsBeforeReload).toBeGreaterThan(0)
    assertNoLegacyRequests()

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(selector).toHaveValue("alpha", { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-agent-type-id", "alpha")
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect.poll(() => addressedRequests.filter(({ method, path }) => (
      method === "GET" && path === `/api/v1/agents/alpha/sessions/${alphaSessionId}/events`
    )).length, { timeout: 10_000 }).toBeGreaterThan(alphaEventsBeforeReload)
    await expect(page.getByLabel("Agent conversation").getByText(alphaPrompt)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText("PI_NATIVE_ASSISTANT_DONE")).toBeVisible({ timeout: 20_000 })
    assertNoLegacyRequests()

    const renamed = `Golden addressed ${Date.now()}`
    const rename = await page.request.post(`/api/v1/agents/alpha/sessions/${encodeURIComponent(alphaSessionId!)}/rename`, {
      headers: workspaceHeaders,
      data: { requestId: `rename-${Date.now()}`, title: renamed },
    })
    const renameBody = await rename.text()
    expect(rename.status(), renameBody).toBe(200)
    expect(JSON.parse(renameBody)).toMatchObject({ title: renamed })
    addressedResponses.push({
      method: "POST",
      path: `/api/v1/agents/alpha/sessions/${alphaSessionId}/rename`,
      status: rename.status(),
    })
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(selector).toHaveValue("alpha", { timeout: 10_000 })
    await expect(page.locator('[data-boring-workspace-part="app-session-row"]').filter({ hasText: renamed })).toBeVisible({ timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    assertNoLegacyRequests()

    await selector.selectOption("beta")
    await expect(selector).toHaveValue("beta")
    await expect(chat).toHaveAttribute("data-agent-type-id", "beta", { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })

    await expect.poll(() => addressedRequests.filter(({ method, path }) => (
      method === "POST" && path === "/api/v1/agents/beta/sessions"
    )).length, { timeout: 10_000 }).toBeGreaterThan(0)
    const betaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(betaSessionId).toBeTruthy()

    const betaPrompt = `beta streamed prompt ${Date.now()}`
    await composer.fill(betaPrompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(betaPrompt)).toBeVisible()
    await expect(page.getByText("PI_NATIVE_ASSISTANT_DONE")).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 20_000 })
    assertNoLegacyRequests()

    const deletion = await page.request.delete(`/api/v1/agents/beta/sessions/${encodeURIComponent(betaSessionId!)}`, {
      headers: workspaceHeaders,
    })
    expect(deletion.status(), await deletion.text()).toBe(204)
    addressedResponses.push({
      method: "DELETE",
      path: `/api/v1/agents/beta/sessions/${betaSessionId}`,
      status: deletion.status(),
    })

    await selector.selectOption("alpha")
    await expect(chat).toHaveAttribute("data-agent-type-id", "alpha", { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!)
    await expect(page.getByLabel("Agent conversation").getByText(alphaPrompt)).toBeVisible({ timeout: 15_000 })

    for (const agentTypeId of ["alpha", "beta"]) {
      expect(addressedRequests.some(({ method, path }) => (
        method === "GET" && path === `/api/v1/agents/${agentTypeId}/sessions`
      )), JSON.stringify(addressedRequests, null, 2)).toBe(true)
      expect(addressedRequests.some(({ method, path }) => (
        method === "POST" && path === `/api/v1/agents/${agentTypeId}/sessions`
      )), JSON.stringify(addressedRequests, null, 2)).toBe(true)
      expect(addressedRequests.some(({ method, path }) => (
        method === "POST" && path.endsWith(`/prompt`) && path.includes(`/api/v1/agents/${agentTypeId}/sessions/`)
      )), JSON.stringify(addressedRequests, null, 2)).toBe(true)
      expect(addressedRequests.some(({ method, path }) => (
        method === "GET" && path.endsWith(`/events`) && path.includes(`/api/v1/agents/${agentTypeId}/sessions/`)
      )), JSON.stringify(addressedRequests, null, 2)).toBe(true)
    }
    const expectedOperations = [
      ["GET", "/api/v1/agents/alpha/sessions", 200],
      ["POST", "/api/v1/agents/alpha/sessions", 201],
      ["GET", `/api/v1/agents/alpha/sessions/${alphaSessionId}/events`, 200],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/prompt`, 202],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/followup`, 202],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/queue/clear`, 202],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/interrupt`, 202],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/stop`, 202],
      ["POST", `/api/v1/agents/alpha/sessions/${alphaSessionId}/rename`, 200],
      ["GET", "/api/v1/agents/beta/sessions", 200],
      ["POST", "/api/v1/agents/beta/sessions", 201],
      ["GET", `/api/v1/agents/beta/sessions/${betaSessionId}/events`, 200],
      ["POST", `/api/v1/agents/beta/sessions/${betaSessionId}/prompt`, 202],
      ["DELETE", `/api/v1/agents/beta/sessions/${betaSessionId}`, 204],
    ] as const
    for (const [method, path, status] of expectedOperations) {
      expect(
        addressedResponses.some((item) => item.method === method && item.path === path && item.status === status),
        JSON.stringify(addressedResponses, null, 2),
      ).toBe(true)
    }
    expect(addressedResponses.every(({ status }) => status >= 200 && status < 300)).toBe(true)
    assertNoLegacyRequests()
  })
})
