import { expect, test, type Page, type Response } from "@playwright/test"

// Every addressed session route carries the agent type id in its path. The
// playground boots the scripted two-Agent fleet (`alpha` + `beta`), so the
// golden route is checked against the seat the app actually addresses rather
// than a hardcoded id — the exact expected paths are still asserted below.
const operationPath = /\/api\/v1\/agents\/[^/]+\/sessions(?:$|\?|\/[^/]+\/(?:events|prompt|followup|queue\/clear|interrupt|stop|rename))/

/** The composition apps/workspace-playground boots for e2e (see twoAgentFleet.ts). */
const EXPECTED_AGENT_CATALOG = [
  { agentTypeId: "alpha", label: "Alpha", pluginIds: ["scripted-alpha-capability"] },
  { agentTypeId: "beta", label: "Beta", pluginIds: ["scripted-beta-capability"] },
]

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
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    page.on("response", (response: Response) => {
      const url = new URL(response.url())
      if (operationPath.test(`${url.pathname}${url.search}`)) {
        responses.push({ method: response.request().method(), path: url.pathname, status: response.status() })
      }
    })

    await page.goto("/")
    const navigation = page.locator('aside[aria-label="App navigation"]')
    await navigation.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
      throw new Error(`workspace shell did not render; page errors: ${pageErrors.join(" | ") || "none"}`)
    })
    const composer = page.getByRole("textbox", { name: "Agent prompt" })
    const chat = page.locator('[data-boring-agent-part="chat"]')
    await expect(composer).toBeVisible()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })

    const workspaceMeta = await (await page.request.get("/api/v1/workspace/meta")).json() as {
      workspaceId: string
      defaultAgentTypeId: string
    }
    const workspaceHeaders = { "x-boring-workspace-id": workspaceMeta.workspaceId }
    const catalog = await page.request.get("/api/v1/agents", { headers: workspaceHeaders })
    expect(catalog.status()).toBe(200)
    expect(await catalog.json()).toEqual(EXPECTED_AGENT_CATALOG)
    const agentTypeId = workspaceMeta.defaultAgentTypeId
    expect(EXPECTED_AGENT_CATALOG.map((agent) => agent.agentTypeId)).toContain(agentTypeId)
    const sessionsRoute = `/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`

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

    await expect(page.locator('[data-boring-agent-message-role="assistant"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("chat-working")).toHaveCount(0, { timeout: 15_000 })

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", sessionId!)
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })
    await expect(page.getByLabel("Agent conversation").getByText(prompt)).toBeVisible({ timeout: 10_000 })

    const renamed = `Golden addressed ${Date.now()}`
    const rename = await page.request.post(`${sessionsRoute}/${encodeURIComponent(sessionId!)}/rename`, {
      headers: workspaceHeaders,
      data: { requestId: `rename-${Date.now()}`, title: renamed },
    })
    const renameBody = await rename.text()
    expect(rename.status(), renameBody).toBe(200)
    expect(JSON.parse(renameBody)).toMatchObject({ title: renamed })
    responses.push({
      method: "POST",
      path: `${sessionsRoute}/${sessionId}/rename`,
      status: rename.status(),
    })
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.locator('[data-boring-workspace-part="app-session-row"]').filter({ hasText: renamed })).toBeVisible({ timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 10_000 })

    const deletion = await page.request.delete(`${sessionsRoute}/${encodeURIComponent(sessionId!)}`, {
      headers: workspaceHeaders,
    })
    expect(deletion.status(), await deletion.text()).toBe(204)
    responses.push({
      method: "DELETE",
      path: `${sessionsRoute}/${sessionId}`,
      status: deletion.status(),
    })

    const expectedOperations = [
      ["GET", sessionsRoute, 200],
      ["POST", sessionsRoute, 201],
      ["GET", `${sessionsRoute}/${sessionId}/events`, 200],
      ["POST", `${sessionsRoute}/${sessionId}/prompt`, 202],
      ["POST", `${sessionsRoute}/${sessionId}/rename`, 200],
      ["DELETE", `${sessionsRoute}/${sessionId}`, 204],
    ] as const
    for (const [method, path, status] of expectedOperations) {
      expect(responses.some((item) => item.method === method && item.path === path && item.status === status), JSON.stringify(responses, null, 2)).toBe(true)
    }
    expect(responses.every(({ status }) => status >= 200 && status < 300)).toBe(true)
  })
})
