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

    const startFirstChat = page.getByRole("button", { name: "Start new chat" })
    await expect(startFirstChat).toBeVisible({ timeout: 15_000 })
    await startFirstChat.click()

    const activeChatPane = page.locator('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')
    const chat = activeChatPane.locator('[data-boring-agent-part="chat"]')
    await expect(chat).toHaveAttribute("data-agent-type-id", "alpha")
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const composer = activeChatPane.getByRole("textbox", { name: "Agent prompt" })
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })
    expect(catalogRequests).toBe(1)
    assertNoLegacyRequests()

    const workspaceMeta = await (await page.request.get("/api/v1/workspace/meta")).json() as { workspaceId: string }
    const workspaceHeaders = { "x-boring-workspace-id": workspaceMeta.workspaceId }
    const initialAlphaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    const alphaSessionCreated = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === "/api/v1/agents/alpha/sessions"
    })
    await runCommand(page, "New Chat")
    expect((await alphaSessionCreated).status()).toBe(201)
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
    const clearedFollowupAccepted = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === `/api/v1/agents/alpha/sessions/${alphaSessionId}/followup`
    })
    await composer.press("Enter")
    expect((await clearedFollowupAccepted).status()).toBe(202)
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview-text"]')).toContainText(clearedFollowup, { timeout: 10_000 })
    const queueCleared = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === `/api/v1/agents/alpha/sessions/${alphaSessionId}/queue/clear`
    })
    await page.getByRole("button", { name: "Edit queued follow-ups" }).click()
    expect((await queueCleared).status()).toBe(202)
    await expect(page.locator('[data-boring-agent-part="composer-queue-preview"]')).toHaveCount(0)
    await expect(composer).toHaveValue(clearedFollowup)

    const continuedFollowup = "golden queued then continued"
    await composer.fill(continuedFollowup)
    const continuedFollowupAccepted = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === `/api/v1/agents/alpha/sessions/${alphaSessionId}/followup`
    })
    await composer.press("Enter")
    expect((await continuedFollowupAccepted).status()).toBe(202)
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
    await expect(startFirstChat).toBeVisible({ timeout: 15_000 })
    await startFirstChat.click()
    await expect(chat).toHaveAttribute("data-agent-type-id", "beta", { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })

    const initialBetaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    const betaSessionCreated = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === "/api/v1/agents/beta/sessions"
    })
    await runCommand(page, "New Chat")
    expect((await betaSessionCreated).status()).toBe(201)
    let betaSessionId: string | null = null
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      betaSessionId = nextSessionId && nextSessionId !== initialBetaSessionId ? nextSessionId : null
      return betaSessionId
    }, { timeout: 10_000 }).not.toBeNull()
    expect(betaSessionId).toBeTruthy()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })

    const betaPrompt = `beta streamed prompt ${Date.now()}`
    await composer.fill(betaPrompt)
    await chat.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(chat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(chat.getByLabel("Agent conversation").getByText(betaPrompt)).toBeVisible()
    await expect(chat.getByText("PI_NATIVE_ASSISTANT_DONE")).toBeVisible({ timeout: 20_000 })
    await expect(chat.getByTestId("chat-working")).toHaveCount(0, { timeout: 20_000 })
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

    const betaReplacementCreated = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === "/api/v1/agents/beta/sessions"
    })
    await runCommand(page, "New Chat")
    expect((await betaReplacementCreated).status()).toBe(201)
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      return nextSessionId && nextSessionId !== betaSessionId ? nextSessionId : null
    }, { timeout: 10_000 }).not.toBeNull()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })

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
    expect(
      addressedResponses.filter(({ status }) => status < 200 || status >= 300),
      JSON.stringify(addressedResponses, null, 2),
    ).toEqual([])
    assertNoLegacyRequests()
  })

  test("keeps two addressed streams and transcripts live across mid-stream agent switches", async ({ page }) => {
    test.setTimeout(90_000)

    const requests: Array<{ method: string; path: string; body: string | null }> = []
    const legacyRequests: string[] = []
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith(LEGACY_PI_CHAT_PATH)) legacyRequests.push(`${request.method()} ${url.pathname}`)
      if (url.pathname.startsWith("/api/v1/agents/")) {
        requests.push({ method: request.method(), path: url.pathname, body: request.postData() })
      }
    })

    await page.goto("/?fresh=1")
    const selector = page.getByRole("combobox", { name: "Agent" })
    await expect(selector).toHaveValue("alpha", { timeout: 10_000 })

    const ensureAddressedChat = async (agentTypeId: string) => {
      const chat = page.locator(`[data-boring-agent-part="chat"][data-agent-type-id="${agentTypeId}"]`).last()
      const startFirstChat = page.getByRole("button", { name: "Start new chat" })
      await expect.poll(async () => {
        if (await startFirstChat.isVisible()) return "empty"
        return await chat.getAttribute("data-pi-chat-connection") ?? "pending"
      }, { timeout: 30_000 }).toMatch(/^(empty|connected)$/)
      if (await startFirstChat.isVisible()) {
        await expect(page.locator(
          `[data-boring-agent-part="chat"][data-agent-type-id="${agentTypeId}"][data-pi-chat-session-id="default"]`,
        )).toHaveCount(0)
        await startFirstChat.click()
      }
      await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
      return chat
    }

    const alphaChat = await ensureAddressedChat("alpha")
    const alphaSessionId = await alphaChat.getAttribute("data-pi-chat-session-id")
    expect(alphaSessionId).toBeTruthy()
    const alphaPrompt = `alpha concurrent ${Date.now()}`
    await alphaChat.getByRole("textbox", { name: "Agent prompt" }).fill(alphaPrompt)
    await alphaChat.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(alphaChat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Alpha streaming")).toBeVisible()

    await selector.selectOption("beta")
    const betaChat = await ensureAddressedChat("beta")
    const betaSessionId = await betaChat.getAttribute("data-pi-chat-session-id")
    expect(betaSessionId).toBeTruthy()
    const betaPrompt = `beta concurrent ${Date.now()}`
    await betaChat.getByRole("textbox", { name: "Agent prompt" }).fill(betaPrompt)
    await betaChat.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(betaChat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Beta streaming")).toBeVisible()

    await selector.selectOption("alpha")
    await expect(alphaChat).toBeVisible()
    await expect(betaChat).toBeVisible()
    await expect(page.getByLabel("Alpha streaming")).toBeVisible()
    await expect(page.getByLabel("Beta streaming")).toBeVisible()

    await expect(alphaChat.getByLabel("Agent conversation").getByText(alphaPrompt)).toHaveCount(1)
    await expect(betaChat.getByLabel("Agent conversation").getByText(betaPrompt)).toHaveCount(1)
    await expect(alphaChat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toHaveCount(1, { timeout: 30_000 })
    await expect(betaChat.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toHaveCount(1, { timeout: 30_000 })
    await expect(alphaChat.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toHaveCount(0)
    await expect(betaChat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Alpha idle")).toBeVisible()
    await expect(page.getByLabel("Beta idle")).toBeVisible()

    await selector.selectOption("beta")
    await expect(betaChat).toHaveAttribute("data-pi-chat-session-id", betaSessionId!)
    await selector.selectOption("alpha")
    await expect(alphaChat).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!)

    const alphaPrefix = `/api/v1/agents/alpha/sessions/${alphaSessionId}`
    const betaPrefix = `/api/v1/agents/beta/sessions/${betaSessionId}`
    if (process.env.E2E_DEBUG_REQUESTS === "1") {
      console.log(JSON.stringify(requests, null, 2))
    }
    expect(requests).toContainEqual({ method: "GET", path: `${alphaPrefix}/events`, body: null })
    expect(requests).toContainEqual({ method: "GET", path: `${betaPrefix}/events`, body: null })
    const promptRequests = requests.filter(({ method, path }) => method === "POST" && path.endsWith("/prompt"))
    expect(promptRequests).toHaveLength(2)
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${alphaPrefix}/prompt`,
      body: expect.stringContaining(alphaPrompt),
    }))
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${betaPrefix}/prompt`,
      body: expect.stringContaining(betaPrompt),
    }))
    expect(promptRequests.some(({ path, body }) => path === `${alphaPrefix}/prompt` && body?.includes(betaPrompt))).toBe(false)
    expect(promptRequests.some(({ path, body }) => path === `${betaPrefix}/prompt` && body?.includes(alphaPrompt))).toBe(false)
    expect(legacyRequests).toEqual([])
  })

  test("keeps a single addressed agent on its addressed route without switcher chrome", async ({ page }) => {
    test.setTimeout(60_000)

    const requests: string[] = []
    await page.route("**/api/v1/agents", async (route) => {
      requests.push(`${route.request().method()} /api/v1/agents`)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ agentTypeId: "alpha", label: "Alpha" }]),
      })
    })
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith("/api/v1/agents/alpha/") || url.pathname.startsWith(LEGACY_PI_CHAT_PATH)) {
        requests.push(`${request.method()} ${url.pathname}`)
      }
    })

    await page.goto("/?fresh=1")
    await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0)
    const chat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    const sessionId = await chat.getAttribute("data-pi-chat-session-id")
    expect(sessionId).toBeTruthy()
    const completion = chat.getByLabel("Agent conversation")
      .getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })
    const completionCountBefore = await completion.count()
    const prompt = `single addressed ${Date.now()}`
    await chat.getByRole("textbox", { name: "Agent prompt" }).fill(prompt)
    await chat.locator('[data-boring-agent-part="composer-submit"]').click()
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", sessionId!)
    await expect(chat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(chat.getByLabel("Agent conversation").getByText(prompt)).toHaveCount(1)
    await expect(chat.getByTestId("chat-working")).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByLabel("Alpha idle")).toBeVisible()
    await expect(completion).toHaveCount(completionCountBefore + 1)

    expect(requests.some((request) => request.includes("/api/v1/agents/alpha/sessions"))).toBe(true)
    expect(requests.some((request) => request.includes(LEGACY_PI_CHAT_PATH))).toBe(false)
  })
})
