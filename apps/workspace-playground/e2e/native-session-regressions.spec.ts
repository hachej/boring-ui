import { expect, test, type Page } from "@playwright/test"

async function runCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+KeyK")
  const palette = page.getByRole("dialog", { name: /command palette/i })
  await expect(palette).toBeVisible()
  await page.keyboard.type(`>${command}`)
  await page.getByRole("option", { name: new RegExp(command, "i") }).first().click()
  await expect(palette).toBeHidden()
}

async function openFreshWorkspace(page: Page): Promise<void> {
  await page.goto("/?fresh=1")
  await expect(page.locator('aside[aria-label="App navigation"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("combobox", { name: "Agent" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Agents" })).toBeVisible({ timeout: 10_000 })
}

async function createLocalChat(page: Page): Promise<{
  chat: ReturnType<Page["locator"]>
  composer: ReturnType<Page["getByRole"]>
  localSessionId: string
}> {
  const createdRequests: string[] = []
  const recordCreate = (request: import("@playwright/test").Request) => {
    const url = new URL(request.url())
    if (request.method() === "POST" && url.pathname === "/api/v1/agents/alpha/sessions") {
      createdRequests.push(url.pathname)
    }
  }
  page.on("request", recordCreate)
  await runCommand(page, "New Chat")
  const activePane = page.locator('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')
  const chat = activePane.locator('[data-boring-agent-part="chat"]')
  await expect(chat).toBeVisible({ timeout: 10_000 })
  await expect(chat).toHaveAttribute("data-agent-type-id", "alpha")
  const localSessionId = await chat.getAttribute("data-pi-chat-session-id")
  expect(localSessionId).toMatch(/^local-/)
  await page.waitForTimeout(300)
  expect(createdRequests, "opening a chat must not create a durable server session before first send").toEqual([])
  page.off("request", recordCreate)
  return {
    chat,
    composer: activePane.getByRole("textbox", { name: "Agent prompt" }),
    localSessionId: localSessionId!,
  }
}

async function sendFirstMessage(
  page: Page,
  chat: ReturnType<Page["locator"]>,
  composer: ReturnType<Page["getByRole"]>,
  localSessionId: string,
  prompt: string,
): Promise<string> {
  const created = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === "POST"
      && url.pathname === "/api/v1/agents/alpha/sessions"
  })
  await composer.fill(prompt)
  await chat.locator('[data-boring-agent-part="composer-submit"]').click()
  expect((await created).status()).toBe(201)
  await expect(chat.getByLabel("Agent conversation").getByText(prompt)).toBeVisible({ timeout: 10_000 })
  await expect(chat.getByText("PI_NATIVE_ASSISTANT_DONE:alpha", { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(chat.getByTestId("chat-working")).toHaveCount(0, { timeout: 30_000 })

  let adoptedSessionId = ""
  await expect.poll(async () => {
    adoptedSessionId = await chat.getAttribute("data-pi-chat-session-id") ?? ""
    return adoptedSessionId
  }, { timeout: 10_000 }).not.toBe(localSessionId)
  expect(adoptedSessionId).not.toMatch(/^local-/)
  return adoptedSessionId
}

test.describe("native addressed session regressions", () => {
  test("first message creates, adopts, streams, and can be renamed from the session menu", async ({ page }) => {
    test.setTimeout(90_000)
    await openFreshWorkspace(page)
    const { chat, composer, localSessionId } = await createLocalChat(page)
    const prompt = `first native prompt ${Date.now()}`
    const nativeSessionId = await sendFirstMessage(page, chat, composer, localSessionId, prompt)

    const row = page
      .getByRole("region", { name: "Alpha agent" })
      .locator(
        `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${nativeSessionId}"][data-boring-agent-type-id="alpha"]`,
      )
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.hover()
    await row.getByRole("button", { name: /More options for/ }).click()
    await page.getByRole("menuitem", { name: "Rename" }).click()
    const rename = row.getByRole("textbox", { name: "Rename session" })
    const renamed = `Renamed native ${Date.now()}`
    await rename.fill(renamed)
    await rename.press("Enter")
    await expect(row).toContainText(renamed, { timeout: 10_000 })
  })

  test("switching between two adopted sessions renders the matching transcript", async ({ page }) => {
    test.setTimeout(120_000)
    await openFreshWorkspace(page)

    const first = await createLocalChat(page)
    const firstPrompt = `first transcript ${Date.now()}`
    const firstSessionId = await sendFirstMessage(
      page,
      first.chat,
      first.composer,
      first.localSessionId,
      firstPrompt,
    )

    const second = await createLocalChat(page)
    const secondPrompt = `second transcript ${Date.now()}`
    const secondSessionId = await sendFirstMessage(
      page,
      second.chat,
      second.composer,
      second.localSessionId,
      secondPrompt,
    )
    expect(secondSessionId).not.toBe(firstSessionId)
    await expect(second.chat.getByLabel("Agent conversation").getByText(secondPrompt)).toBeVisible()

    const firstRow = page.locator(
      `[data-boring-workspace-part="app-session-row"][data-boring-session-id="${firstSessionId}"]`,
    )
    await firstRow.getByRole("button").first().click()
    const activeChat = page.locator(
      '[data-boring-workspace-part="chat-pane"][data-boring-state="active"] [data-boring-agent-part="chat"]',
    )
    await expect(activeChat).toHaveAttribute("data-pi-chat-session-id", firstSessionId, { timeout: 10_000 })
    await expect(activeChat.getByLabel("Agent conversation").getByText(firstPrompt)).toBeVisible({ timeout: 15_000 })
    await expect(activeChat.getByLabel("Agent conversation").getByText(secondPrompt)).toHaveCount(0)
  })

  test("a newly created local chat renders without a wake-up click", async ({ page }) => {
    test.setTimeout(60_000)
    await openFreshWorkspace(page)
    const { chat, composer, localSessionId } = await createLocalChat(page)

    await expect(chat).toHaveAttribute("data-pi-chat-session-id", localSessionId)
    await expect(chat.getByLabel("Agent conversation")).toBeVisible()
    await expect(composer).toBeVisible()
    await expect(composer).toBeEnabled()
    await expect(chat.locator('[data-boring-agent-part="composer-submit"]')).toBeVisible()
  })
})
