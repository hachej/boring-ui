import { expect, test, type Page, type Response } from "@playwright/test"

const operationPath = /\/api\/v1\/agent\/pi-chat\/(?:sessions(?:$|\?)|[^/]+\/(?:events|prompt|followup|interrupt|stop|queue\/clear))|\/api\/v1\/agents\/default\/sessions\/[^/]+\/rename/

async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+KeyK")
  const palette = page.getByRole("dialog", { name: /command palette/i })
  await expect(palette).toBeVisible()
  await page.keyboard.type(`>${command}`)
  await page.getByRole("option", { name: new RegExp(command, "i") }).first().click()
  await expect(palette).toBeHidden()
}

test.describe("checkpoint-D Agent Host golden route", () => {
  test("boots the real playground wire and completes deterministic interactive session operations", async ({ page }) => {
    test.setTimeout(90_000)

    const responses: Array<{ method: string; path: string; status: number }> = []
    page.on("response", (response: Response) => {
      const url = new URL(response.url())
      if (operationPath.test(`${url.pathname}${url.search}`)) {
        responses.push({ method: response.request().method(), path: url.pathname, status: response.status() })
      }
    })

    await page.goto("/?fresh=1")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await expect(composer).toBeVisible()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })

    const workspaceMeta = await (await page.request.get("/api/v1/workspace/meta")).json() as { workspaceId: string }
    const workspaceHeaders = { "x-boring-workspace-id": workspaceMeta.workspaceId }
    const catalog = await page.request.get("/api/v1/agents", { headers: workspaceHeaders })
    expect(catalog.status()).toBe(200)
    expect(await catalog.json()).toEqual([{ agentTypeId: "default", label: "Agent" }])

    const initialSessionId = await chat.getAttribute("data-pi-chat-session-id")
    await runCommand(page, "New Chat")
    let sessionId: string | null = null
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      sessionId = nextSessionId && nextSessionId !== initialSessionId ? nextSessionId : null
      return sessionId
    }, { timeout: 10_000 }).not.toBeNull()
    await expect.poll(() => page.locator('[data-boring-workspace-part="app-session-row"]').count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const prompt = `golden prompt ${Date.now()}`
    await composer.fill(prompt)
    await page.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(page.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(prompt)).toBeVisible()
    await expect(page.locator('[data-boring-agent-message-role="assistant"]')).toBeVisible({ timeout: 10_000 })

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
    const interrupt = await page.request.post(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId!)}/interrupt`, {
      headers: workspaceHeaders,
      data: {},
    })
    expect(interrupt.status(), await interrupt.text()).toBe(202)
    responses.push({ method: "POST", path: `/api/v1/agent/pi-chat/${sessionId}/interrupt`, status: interrupt.status() })
    await expect(page.getByLabel("Agent conversation").getByText(continuedFollowup)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0, { timeout: 10_000 })
    const stop = await page.request.post(`/api/v1/agent/pi-chat/${encodeURIComponent(sessionId!)}/stop`, {
      headers: workspaceHeaders,
      data: {},
    })
    expect(stop.status(), await stop.text()).toBe(202)
    responses.push({ method: "POST", path: `/api/v1/agent/pi-chat/${sessionId}/stop`, status: stop.status() })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 10_000 })

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", sessionId!)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(prompt)).toBeVisible({ timeout: 10_000 })

    const renamed = `Golden legacy ${Date.now()}`
    const rename = await page.request.post(`/api/v1/agents/default/sessions/${encodeURIComponent(sessionId!)}/rename`, {
      headers: workspaceHeaders,
      data: { requestId: `rename-${Date.now()}`, title: renamed },
    })
    const renameBody = await rename.text()
    expect(rename.status(), renameBody).toBe(200)
    expect(JSON.parse(renameBody)).toMatchObject({ title: renamed })
    responses.push({
      method: "POST",
      path: `/api/v1/agents/default/sessions/${sessionId}/rename`,
      status: rename.status(),
    })
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator('[data-boring-workspace-part="app-session-row"]').filter({ hasText: renamed })).toBeVisible({ timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })

    const expectedOperations = [
      ["GET", "/api/v1/agent/pi-chat/sessions", 200],
      ["POST", "/api/v1/agent/pi-chat/sessions", 201],
      ["GET", `/api/v1/agent/pi-chat/${sessionId}/events`, 200],
      ["POST", `/api/v1/agent/pi-chat/${sessionId}/prompt`, 202],
      ["POST", `/api/v1/agent/pi-chat/${sessionId}/followup`, 202],
      ["POST", `/api/v1/agent/pi-chat/${sessionId}/queue/clear`, 202],
      ["POST", `/api/v1/agent/pi-chat/${sessionId}/interrupt`, 202],
      ["POST", `/api/v1/agent/pi-chat/${sessionId}/stop`, 202],
      ["POST", `/api/v1/agents/default/sessions/${sessionId}/rename`, 200],
    ] as const
    for (const [method, path, status] of expectedOperations) {
      expect(responses.some((item) => item.method === method && item.path === path && item.status === status), JSON.stringify(responses, null, 2)).toBe(true)
    }
    expect(responses.every(({ status }) => status >= 200 && status < 300)).toBe(true)
  })
})
