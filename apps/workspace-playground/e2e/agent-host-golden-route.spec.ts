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

async function sendFirstAddressedMessage(
  page: Page,
  chat: ReturnType<Page["locator"]>,
  agentTypeId: string,
  prompt: string,
): Promise<string> {
  const localSessionId = await chat.getAttribute("data-pi-chat-session-id")
  expect(localSessionId).toMatch(/^local-/)
  const created = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === "POST"
      && url.pathname === `/api/v1/agents/${agentTypeId}/sessions`
  })
  await chat.getByRole("textbox", { name: "Agent prompt" }).fill(prompt)
  await chat.locator('[data-boring-agent-part="composer-submit"]').click()
  expect((await created).status()).toBe(201)

  let adoptedSessionId = ""
  await expect.poll(async () => {
    adoptedSessionId = await chat.getAttribute("data-pi-chat-session-id") ?? ""
    return adoptedSessionId
  }, { timeout: 15_000 }).not.toBe(localSessionId)
  expect(adoptedSessionId).not.toMatch(/^local-/)
  await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
  return adoptedSessionId
}

async function expectHorizontalSplit(
  first: ReturnType<Page["locator"]>,
  second: ReturnType<Page["locator"]>,
): Promise<void> {
  await expect(first).toBeVisible()
  await expect(second).toBeVisible()
  const [firstBox, secondBox] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
  ])
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  const a = firstBox!
  const b = secondBox!
  const horizontalGap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
  const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  expect(horizontalGap, `chat panes overlap horizontally: ${JSON.stringify({ a, b })}`).toBeGreaterThanOrEqual(-1)
  expect(verticalOverlap, `chat panes are not side by side: ${JSON.stringify({ a, b })}`).toBeGreaterThan(100)
  expect(a.width).toBeGreaterThan(200)
  expect(b.width).toBeGreaterThan(200)
}

test.describe("addressed Agent Host browser wire", () => {
  test("creates addressed chats from named agent rows and opens them in split", async ({ page }) => {
    test.setTimeout(90_000)

    await page.goto("/?fresh=1")
    await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0)

    const agentsToggle = page.getByRole("button", { name: "Agents" })
    await expect(agentsToggle).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("region", { name: "Alpha agent" })).toBeVisible()
    await expect(page.getByRole("region", { name: "Beta agent" })).toBeVisible()

    const betaPrimary = page.getByRole("button", { name: "New chat with Beta", exact: true })
    const betaSplit = page.getByRole("button", { name: "New chat with Beta in split" })
    const betaQuick = page.getByRole("button", { name: "Quick chat with Beta" })
    await expect(betaPrimary.locator("svg.lucide-plus")).toBeVisible()
    await betaPrimary.hover()
    await expect(betaSplit.locator("svg.lucide-columns-2")).toBeVisible()
    await expect(betaQuick.locator("svg.lucide-zap")).toBeVisible()
    await betaPrimary.click()
    const betaChat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="beta"]').last()
    await expect(betaChat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
    await expect(page.getByLabel(/^Chat session Beta · /)).toBeVisible()
    const betaPrompt = `beta agent row ${Date.now()}`
    const betaSessionId = await sendFirstAddressedMessage(page, betaChat, "beta", betaPrompt)
    await expect(betaChat.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(betaChat.getByRole("button", { name: /beta_capability/ })).toBeVisible()
    await expect(betaChat.getByRole("button", { name: /alpha_capability/ })).toHaveCount(0)

    const alphaPrimary = page.getByRole("button", { name: "New chat with Alpha", exact: true })
    await alphaPrimary.hover()
    await page.getByRole("button", { name: "New chat with Alpha in split" }).click()
    const alphaChat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
    await expect(alphaChat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
    await expect(page.getByLabel(/^Chat session Alpha · /)).toBeVisible()
    await expectHorizontalSplit(betaChat, alphaChat)
    const alphaPrompt = `alpha capability ${Date.now()}`
    const alphaSessionId = await sendFirstAddressedMessage(page, alphaChat, "alpha", alphaPrompt)
    await expect(alphaChat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(alphaChat.getByRole("button", { name: /alpha_capability/ })).toBeVisible()
    await expect(alphaChat.getByRole("button", { name: /beta_capability/ })).toHaveCount(0)

    const chats = page.getByRole("region", { name: "Chats" })
    const betaChatRow = chats.locator(
      `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${betaSessionId}"][data-boring-agent-type-id="beta"]`,
    )
    const alphaChatRow = chats.locator(
      `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${alphaSessionId}"][data-boring-agent-type-id="alpha"]`,
    )
    await expect(betaChatRow).toBeVisible()
    await expect(alphaChatRow).toBeVisible()
    await expect(betaChatRow.locator('[data-boring-agent-badge="beta"]')).toBeVisible()
    await expect(alphaChatRow.locator('[data-boring-agent-badge="alpha"]')).toBeVisible()
    await expect(alphaChatRow).toHaveAttribute("data-boring-session-state", "active")

    const filter = chats.getByRole("button", { name: "Filter chats by agent" })
    await filter.click()
    await page.getByRole("menuitemradio", { name: "Alpha" }).click()
    await expect(alphaChatRow).toBeVisible()
    await expect(betaChatRow).toHaveCount(0)
    await filter.click()
    await page.getByRole("menuitemradio", { name: "All agents" }).click()
    await expect(betaChatRow).toBeVisible()

    await betaChatRow.hover()
    await betaChatRow.getByRole("button", { name: /^Pin / }).click()
    const pinned = page.getByRole("region", { name: "Pinned" })
    const pinnedBetaRow = pinned.locator(
      `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${betaSessionId}"][data-boring-agent-type-id="beta"]`,
    )
    await expect(pinnedBetaRow).toBeVisible()
    await expect(pinnedBetaRow.locator('[data-boring-agent-badge="beta"]')).toBeVisible()
    await expect(betaChatRow).toHaveCount(0)
    await expect(pinnedBetaRow).toBeVisible()
  })

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
    await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-expanded", "true")
    await expect(page.getByRole("button", { name: "New chat with Alpha", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "New chat with Beta", exact: true })).toBeVisible()

    await page.getByRole("button", { name: "New chat with Alpha", exact: true }).click()

    const activeChatPane = page.locator('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')
    const chat = activeChatPane.locator('[data-boring-agent-part="chat"]')
    await expect(chat).toHaveAttribute("data-agent-type-id", "alpha")
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "disconnected")
    const composer = activeChatPane.getByRole("textbox", { name: "Agent prompt" })
    await expect(composer).toBeVisible({ timeout: 15_000 })
    await expect(composer).toBeEnabled({ timeout: 15_000 })
    expect(catalogRequests).toBe(1)
    assertNoLegacyRequests()

    const workspaceMeta = await (await page.request.get("/api/v1/workspace/meta")).json() as { workspaceId: string }
    const workspaceHeaders = { "x-boring-workspace-id": workspaceMeta.workspaceId }
    const initialAlphaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    await runCommand(page, "New Chat")
    let alphaDraftSessionId: string | null = null
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      alphaDraftSessionId = nextSessionId && nextSessionId !== initialAlphaSessionId ? nextSessionId : null
      return alphaDraftSessionId
    }, { timeout: 10_000 }).not.toBeNull()
    expect(alphaDraftSessionId).toMatch(/^local-/)

    const goldenPrompt = `golden prompt ${Date.now()}`
    const alphaSessionId = await sendFirstAddressedMessage(page, chat, "alpha", goldenPrompt)
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
    await expect(
      page
        .getByRole("region", { name: "Chats" })
        .locator(
          `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${alphaSessionId}"][data-boring-agent-type-id="alpha"]`,
        ),
    ).toContainText(renamed, { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "connected", { timeout: 15_000 })
    assertNoLegacyRequests()

    await page.getByRole("button", { name: "New chat with Beta", exact: true }).click()
    await expect(chat).toHaveAttribute("data-agent-type-id", "beta", { timeout: 10_000 })
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "disconnected")
    await expect(composer).toBeEnabled({ timeout: 15_000 })

    const initialBetaSessionId = await chat.getAttribute("data-pi-chat-session-id")
    await runCommand(page, "New Chat")
    let betaDraftSessionId: string | null = null
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      betaDraftSessionId = nextSessionId && nextSessionId !== initialBetaSessionId ? nextSessionId : null
      return betaDraftSessionId
    }, { timeout: 10_000 }).not.toBeNull()
    expect(betaDraftSessionId).toMatch(/^local-/)
    await expect(composer).toBeEnabled({ timeout: 15_000 })

    const betaPrompt = `beta streamed prompt ${Date.now()}`
    const betaSessionId = await sendFirstAddressedMessage(page, chat, "beta", betaPrompt)
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

    await runCommand(page, "New Chat")
    await expect.poll(async () => {
      const nextSessionId = await chat.getAttribute("data-pi-chat-session-id")
      return nextSessionId && nextSessionId !== betaSessionId ? nextSessionId : null
    }, { timeout: 10_000 }).not.toBeNull()
    await expect(chat).toHaveAttribute("data-pi-chat-connection", "disconnected")

    await page.locator('[data-boring-workspace-part="app-session-row"]').filter({ hasText: renamed }).getByRole("button").first().click()
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

  test("keeps two addressed streams and transcripts live across mid-stream agent switches", async ({ page }, testInfo) => {
    test.setTimeout(150_000)

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
    await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-expanded", "true")

    const ensureAddressedChat = async (agentTypeId: string, split = false) => {
      const chat = page.locator(`[data-boring-agent-part="chat"][data-agent-type-id="${agentTypeId}"]`).last()
      const label = agentTypeId === "alpha" ? "Alpha" : "Beta"
      const primary = page.getByRole("button", { name: `New chat with ${label}`, exact: true })
      if (split) {
        await primary.hover()
        await page.getByRole("button", { name: `New chat with ${label} in split` }).click()
      } else {
        await primary.click()
      }
      await expect(chat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
      await expect(chat).toHaveAttribute("data-pi-chat-connection", "disconnected")
      return chat
    }

    const alphaChat = await ensureAddressedChat("alpha")
    const alphaPrompt = `alpha concurrent ${Date.now()}`
    const alphaSessionId = await sendFirstAddressedMessage(page, alphaChat, "alpha", alphaPrompt)
    await expect(alphaChat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Alpha streaming")).toBeVisible()

    const betaChat = await ensureAddressedChat("beta", true)
    const betaPrompt = `beta concurrent ${Date.now()}`
    const betaSessionId = await sendFirstAddressedMessage(page, betaChat, "beta", betaPrompt)
    await expect(betaChat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByLabel("Beta streaming")).toBeVisible()

    await expectHorizontalSplit(alphaChat, betaChat)
    await expect(page.getByLabel("Alpha streaming")).toBeVisible()
    await expect(page.getByLabel("Beta streaming")).toBeVisible()
    await testInfo.attach("alpha-beta-side-by-side-streaming", {
      body: await page.screenshot(),
      contentType: "image/png",
    })

    await expect(alphaChat.getByLabel("Agent conversation").getByText(alphaPrompt)).toHaveCount(1)
    await expect(betaChat.getByLabel("Agent conversation").getByText(betaPrompt)).toHaveCount(1)
    await expect(alphaChat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toHaveCount(1, { timeout: 30_000 })
    await expect(betaChat.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toHaveCount(1, { timeout: 30_000 })
    await expect(alphaChat.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toHaveCount(0)
    await expect(betaChat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toHaveCount(0)
    await expect(page.getByLabel("Alpha idle")).toBeVisible()
    await expect(page.getByLabel("Beta idle")).toBeVisible()

    const alphaPanePrompt = `alpha pane-local ${Date.now()}`
    const betaPanePrompt = `beta pane-local ${Date.now()}`
    await betaChat.click()
    const alphaComposer = alphaChat.getByRole("textbox", { name: "Agent prompt" })
    await alphaComposer.click()
    await expect(page.locator('[data-boring-workspace-part="chat-pane"]').filter({ has: alphaChat })).toHaveAttribute("data-boring-state", "active")
    const alphaPanePromptAccepted = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === `/api/v1/agents/alpha/sessions/${alphaSessionId}/prompt`
    })
    await alphaComposer.fill(alphaPanePrompt)
    await alphaChat.locator('[data-boring-agent-part="composer-submit"]').click()
    expect((await alphaPanePromptAccepted).status()).toBe(202)
    await expect(alphaChat.getByLabel("Agent conversation").getByText(alphaPanePrompt)).toHaveCount(1, { timeout: 10_000 })

    const betaComposer = betaChat.getByRole("textbox", { name: "Agent prompt" })
    await betaComposer.click()
    await expect(page.locator('[data-boring-workspace-part="chat-pane"]').filter({ has: betaChat })).toHaveAttribute("data-boring-state", "active")
    const betaPanePromptAccepted = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === "POST"
        && url.pathname === `/api/v1/agents/beta/sessions/${betaSessionId}/prompt`
    })
    await betaComposer.fill(betaPanePrompt)
    await betaChat.locator('[data-boring-agent-part="composer-submit"]').click()
    expect((await betaPanePromptAccepted).status()).toBe(202)
    await expect(betaChat.getByLabel("Agent conversation").getByText(betaPanePrompt)).toHaveCount(1, { timeout: 10_000 })
    await expect(alphaChat.getByTestId("chat-working")).toHaveCount(0, { timeout: 30_000 })
    await expect(betaChat.getByTestId("chat-working")).toHaveCount(0, { timeout: 30_000 })

    await expect.poll(() => page.evaluate(() => (
      Object.keys(localStorage).some((key) => key.endsWith(":chatPaneLayout"))
    )), { timeout: 5_000 }).toBe(true)
    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(alphaChat).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!, { timeout: 15_000 })
    await expect(betaChat).toHaveAttribute("data-pi-chat-session-id", betaSessionId!, { timeout: 15_000 })
    await expectHorizontalSplit(alphaChat, betaChat)
    await expect(alphaChat.getByLabel("Agent conversation").getByText(alphaPanePrompt)).toHaveCount(1)
    await expect(betaChat.getByLabel("Agent conversation").getByText(betaPanePrompt)).toHaveCount(1)

    const alphaPrefix = `/api/v1/agents/alpha/sessions/${alphaSessionId}`
    const betaPrefix = `/api/v1/agents/beta/sessions/${betaSessionId}`
    if (process.env.E2E_DEBUG_REQUESTS === "1") {
      console.log(JSON.stringify(requests, null, 2))
    }
    expect(requests).toContainEqual({ method: "GET", path: `${alphaPrefix}/events`, body: null })
    expect(requests).toContainEqual({ method: "GET", path: `${betaPrefix}/events`, body: null })
    const promptRequests = requests.filter(({ method, path }) => method === "POST" && path.endsWith("/prompt"))
    expect(promptRequests).toHaveLength(4)
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${alphaPrefix}/prompt`,
      body: expect.stringContaining(alphaPrompt),
    }))
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${betaPrefix}/prompt`,
      body: expect.stringContaining(betaPrompt),
    }))
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${alphaPrefix}/prompt`,
      body: expect.stringContaining(alphaPanePrompt),
    }))
    expect(promptRequests).toContainEqual(expect.objectContaining({
      path: `${betaPrefix}/prompt`,
      body: expect.stringContaining(betaPanePrompt),
    }))
    expect(promptRequests.some(({ path, body }) => path === `${alphaPrefix}/prompt` && body?.includes(betaPrompt))).toBe(false)
    expect(promptRequests.some(({ path, body }) => path === `${betaPrefix}/prompt` && body?.includes(alphaPrompt))).toBe(false)
    expect(promptRequests.some(({ path, body }) => path === `${alphaPrefix}/prompt` && body?.includes(betaPanePrompt))).toBe(false)
    expect(promptRequests.some(({ path, body }) => path === `${betaPrefix}/prompt` && body?.includes(alphaPanePrompt))).toBe(false)
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
    await expect(page.getByRole("button", { name: "Agents" })).toHaveCount(0)
    const alphaPrimary = page.getByRole("button", { name: "New chat with Alpha", exact: true })
    await expect(alphaPrimary.locator("svg.lucide-plus")).toBeVisible()
    await alphaPrimary.click()
    const chat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
    await expect(page.locator('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')).not.toHaveAttribute("aria-label", /Alpha ·/)
    const completion = chat.getByLabel("Agent conversation")
      .getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })
    const completionCountBefore = await completion.count()
    const prompt = `single addressed ${Date.now()}`
    const sessionId = await sendFirstAddressedMessage(page, chat, "alpha", prompt)
    await expect(chat).toHaveAttribute("data-pi-chat-session-id", sessionId!)
    await expect(chat.getByTestId("chat-working")).toBeVisible({ timeout: 10_000 })
    await expect(chat.getByLabel("Agent conversation").getByText(prompt)).toHaveCount(1)
    await expect(chat.getByTestId("chat-working")).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByLabel("Alpha idle")).toBeVisible()
    await expect(completion).toHaveCount(completionCountBefore + 1)

    const originalChat = page.locator(
      `[data-boring-agent-part="chat"][data-agent-type-id="alpha"][data-pi-chat-session-id="${sessionId}"]`,
    )
    await page.getByRole("button", { name: "New chat with Alpha", exact: true }).hover()
    await page.getByRole("button", { name: "New chat with Alpha in split" }).click()
    const splitChat = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]').last()
    await expect(splitChat).toHaveAttribute("data-pi-chat-session-id", /^local-/, { timeout: 15_000 })
    await expectHorizontalSplit(originalChat, splitChat)

    expect(requests.some((request) => request.includes("/api/v1/agents/alpha/sessions"))).toBe(true)
    expect(requests.some((request) => request.includes(LEGACY_PI_CHAT_PATH))).toBe(false)
  })
})
