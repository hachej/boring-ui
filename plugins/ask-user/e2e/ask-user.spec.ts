import { expect, test } from "@playwright/test"

const question = {
  questionId: "q-e2e",
  sessionId: "default",
  ownerPrincipalId: "anonymous",
  status: "ready",
  title: "Choose A or B",
  context: "Please select one option.",
  answerToken: "secret-e2e",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  schema: {
    wireVersion: 1,
    submitLabel: "Submit",
    fields: [
      {
        type: "radio",
        name: "choice",
        label: "Choice",
        required: true,
        options: [
          { value: "A", label: "A" },
          { value: "B", label: "B" },
        ],
      },
    ],
  },
}

function pendingStateFor(q: typeof question) {
  return {
    "questions.pending": {
      hint: { questionId: q.questionId, sessionId: q.sessionId, status: q.status },
      hintsBySession: { [q.sessionId]: { questionId: q.questionId, sessionId: q.sessionId, status: q.status } },
    },
  }
}

test.describe("ask_user Questions pane", () => {
  test("chat blocker opens the Questions pane only after explicit user action", async ({ page }) => {
    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: pendingStateFor(question) })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      if (body.op === "ask-user.v1.pending") {
        const sessionId = body.input?.sessionId ?? question.sessionId
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { pending: { ...question, sessionId } } } })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { ok: true, status: "answered" } } })
    })

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 10_000 })
    const questionsHeading = page.getByTestId("artifact-surface").getByRole("heading", { name: "Choose A or B" })
    await expect(questionsHeading).toBeHidden({ timeout: 8_000 })

    await page.getByRole("button", { name: "Open Questions" }).evaluate((button: HTMLButtonElement) => button.click())
    await expect(questionsHeading).toBeVisible({ timeout: 8_000 })
  })

  test("chat blocker cancel action cancels the pending question and clears inbox", async ({ page }) => {
    const commands: unknown[] = []
    let cancelled = false
    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: cancelled ? { "questions.pending": { hint: null, hintsBySession: {} } } : pendingStateFor(question) })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      commands.push(body)
      if (body.op === "ask-user.v1.pending") {
        const sessionId = body.input?.sessionId ?? question.sessionId
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { pending: cancelled ? null : { ...question, sessionId } } } })
        return
      }
      if (body.op === "ask-user.v1.cancel") cancelled = true
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { ok: true, status: "cancelled" } } })
    })

    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("button", { name: "Cancel question" })).toBeVisible({ timeout: 10_000 })
    await page.getByRole("button", { name: "Cancel question" }).evaluate((button: HTMLButtonElement) => button.click())

    await expect.poll(() => commands.some((cmd: any) => cmd.op === "ask-user.v1.cancel" && cmd.input?.answerToken === "secret-e2e")).toBe(true)
    await expect(page.getByRole("button", { name: /Inbox 1 inbox item/ })).toHaveCount(0)
  })

  test("inbox zero renders when there are no attention blockers", async ({ page }) => {
    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { "questions.pending": { hint: null, hintsBySession: {} } } })
        return
      }
      await route.fulfill({ status: 204 })
    })
    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      if (body.op === "ask-user.v1.pending") {
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { pending: null } } })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: {} } })
    })

    await page.goto("/", { waitUntil: "domcontentloaded" })
    const inboxButton = page.getByRole("button", { name: /^Inbox$/ })
    await expect(inboxButton).toBeVisible({ timeout: 10_000 })
    await inboxButton.click()
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await expect(page.getByText("Inbox zero")).toBeVisible()
  })

  test("ui command opens pane from metadata, submits, and closes", async ({ page }) => {
    const commands: unknown[] = []
    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        // Regression guard: even if state polling has not caught up yet, the
        // openSurface metadata must be enough to render the live form.
        await route.fulfill({ json: {} })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      commands.push(body)
      if (body.op === "ask-user.v1.pending") {
        const sessionId = body.input?.sessionId ?? question.sessionId
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { pending: { ...question, sessionId } } } })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e", output: { ok: true, status: "answered" } } })
    })

    const commandStreamReady = page.waitForRequest((request) => request.url().includes("/api/v1/ui/commands/next"), { timeout: 10_000 })
    await page.goto("/", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 10_000 })
    await commandStreamReady
    const activeSessionId = await page.locator('[data-pi-chat-session-id]').first().getAttribute('data-pi-chat-session-id')
    await page.request.post("/api/v1/ui/commands", { data: { kind: "openSurface", params: { kind: "questions", target: question.questionId, meta: { sessionId: activeSessionId ?? question.sessionId } } } })

    await expect(page.getByTestId("artifact-surface").getByRole("heading", { name: "Choose A or B" })).toBeVisible({ timeout: 8_000 })
    await page.getByRole("radio", { name: "A" }).click()
    await page.getByTestId("artifact-surface").getByRole("button", { name: "Submit" }).click()

    await expect.poll(() => commands.some((cmd: any) => cmd.op === "ask-user.v1.answer" && cmd.input?.answerToken === "secret-e2e" && cmd.input?.values?.choice === "A")).toBe(true)
    await expect(page.getByText("Choose A or B")).toBeHidden({ timeout: 5_000 })
  })
})
