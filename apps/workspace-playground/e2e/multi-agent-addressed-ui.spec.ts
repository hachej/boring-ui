import { expect, test } from "@playwright/test"

test("discovers two Agents and keeps colliding sessions, capabilities, replacement, and split addressed", async ({ page, request }) => {
  test.setTimeout(180_000)
  const scopeHeaders = {
    "x-boring-workspace-id": "workspace",
    "x-boring-storage-scope-id": "workspace",
  }
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[multi-agent-browser-console] ${message.text()}`)
  })
  page.on("pageerror", (error) => console.error(`[multi-agent-browser-pageerror] ${error.message}`))
  page.on("requestfailed", (failedRequest) => {
    console.error(`[multi-agent-browser-requestfailed] ${failedRequest.failure()?.errorText ?? "unknown"} ${failedRequest.url()}`)
  })
  const createSession = async (agentTypeId: "alpha" | "beta") => {
    const response = await request.post(`/api/v1/agents/${agentTypeId}/sessions`, {
      headers: {
        ...scopeHeaders,
        "x-boring-request-id": `multi-agent-e2e-${agentTypeId}-${Date.now()}`,
      },
    })
    expect(response.ok(), await response.text()).toBe(true)
    const sessionId = (await response.json() as { sessionId: string }).sessionId
    const prompt = await request.post(`/api/v1/agents/${agentTypeId}/sessions/${sessionId}/prompt`, {
      headers: scopeHeaders,
      data: {
        requestId: `multi-agent-e2e-seed-${agentTypeId}-${Date.now()}`,
        clientNonce: `multi-agent-e2e-seed-${agentTypeId}-${Date.now()}`,
        content: `${agentTypeId} seeded transcript`,
      },
    })
    expect(prompt.ok(), await prompt.text()).toBe(true)
    await expect.poll(async () => {
      const state = await request.get(`/api/v1/agents/${agentTypeId}/sessions/${sessionId}/state`, { headers: scopeHeaders })
      if (!state.ok()) return false
      const body = await state.json() as { state?: { status?: string; messages?: unknown[] } }
      return body.state?.status === "idle"
        && JSON.stringify(body.state.messages ?? []).includes(`PI_NATIVE_ASSISTANT_DONE:${agentTypeId}`)
    }, { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => {
      const listed = await request.get(`/api/v1/agents/${agentTypeId}/sessions`, { headers: scopeHeaders })
      if (!listed.ok()) return false
      const body = await listed.json() as { sessions?: Array<{ ref?: { sessionId?: string } }> }
      return (body.sessions ?? []).some((session) => session.ref?.sessionId === sessionId)
    }, { timeout: 60_000 }).toBe(true)
    return sessionId
  }
  const betaSessionId = await createSession("beta")
  const seededAlphaSessionId = await createSession("alpha")
  const addressedPaths: string[] = []
  const legacyPaths: string[] = []
  const apiPrefix = ["", "api", "v1"].join("/")
  const addressedPrefix = `${apiPrefix}/agents/`
  const legacyPrefix = `${apiPrefix}/agent/`
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith(addressedPrefix)) addressedPaths.push(path)
    if (path.startsWith(legacyPrefix)) legacyPaths.push(path)
  })

  await page.goto("/?fresh=1")
  const alphaNew = page.getByRole("button", { name: "New chat with Alpha" })
  const betaNew = page.getByRole("button", { name: "New chat with Beta" })
  await expect(alphaNew).toBeVisible({ timeout: 120_000 })
  await expect(betaNew).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Filter chats by Agent" })).toHaveValue("all")

  const betaRow = page.locator(
    `[data-boring-workspace-part="app-session-row"][data-boring-agent-type-id="beta"][data-boring-session-id="${betaSessionId}"]`,
  )
  await expect(betaRow).toBeVisible()
  await betaRow.locator("button").first().click()
  const beta = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="beta"]')
  await expect(beta).toHaveAttribute("data-pi-chat-session-id", betaSessionId, { timeout: 30_000 })
  await beta.getByRole("textbox", { name: "Agent prompt" }).fill("beta isolation proof")
  await beta.getByRole("textbox", { name: "Agent prompt" }).press("Enter")
  await expect(beta.getByText("PI_NATIVE_ASSISTANT_DONE:beta", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(beta.getByText(/beta_capability/)).toBeVisible()
  await expect(beta.getByText(/alpha_capability/)).toHaveCount(0)

  const alphaSessionId = seededAlphaSessionId
  const alphaRow = page.locator(
    `[data-boring-workspace-part="app-session-row"][data-boring-agent-type-id="alpha"][data-boring-session-id="${alphaSessionId}"]`,
  )
  await expect(alphaRow).toBeVisible()
  await alphaRow.locator("button").first().click()
  const alpha = page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]')
  await expect(alpha).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!, { timeout: 30_000 })
  await expect(beta).toHaveCount(0)
  await alpha.getByRole("textbox", { name: "Agent prompt" }).fill("alpha isolation proof")
  await alpha.getByRole("textbox", { name: "Agent prompt" }).press("Enter")
  await expect(alpha.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(alpha.getByText(/alpha_capability/)).toBeVisible()
  await expect(alpha.getByText(/beta_capability/)).toHaveCount(0)

  await expect(betaRow).toBeVisible()
  await expect(alphaRow).toBeVisible()

  await betaRow.hover()
  await betaRow.getByRole("button", { name: "Chat actions for Scripted baseline" }).click()
  await page.getByRole("menuitem", { name: "Open in new chat pane" }).click()
  await expect(page.locator('[data-boring-agent-part="chat"]')).toHaveCount(2)
  await expect(page.locator('[data-boring-agent-part="chat"][data-agent-type-id="alpha"]')).toHaveAttribute("data-pi-chat-session-id", alphaSessionId!)
  await expect(page.locator('[data-boring-agent-part="chat"][data-agent-type-id="beta"]')).toHaveAttribute("data-pi-chat-session-id", betaSessionId!)

  const filter = page.getByRole("combobox", { name: "Filter chats by Agent" })
  await filter.selectOption("beta")
  await expect(betaRow).toBeVisible()
  await expect(alphaRow).toHaveCount(0)
  await filter.selectOption("all")
  await expect(alphaRow).toBeVisible()

  expect(addressedPaths.some((path) => path.startsWith(`${addressedPrefix}alpha/`))).toBe(true)
  expect(addressedPaths.some((path) => path.startsWith(`${addressedPrefix}beta/`))).toBe(true)
  expect(legacyPaths).toEqual([])
})
