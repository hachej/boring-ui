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

test.describe("ask_user Questions pane", () => {
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
    const workbenchButton = page.getByRole("button", { name: /^open workbench$/i })
    if (await workbenchButton.isVisible().catch(() => false)) await workbenchButton.click()
    await commandStreamReady
    const activeSessionId = await page.locator('[data-pi-chat-session-id]').first().getAttribute('data-pi-chat-session-id')
    await page.request.post("/api/v1/ui/commands", { data: { kind: "openSurface", params: { kind: "questions", target: question.questionId, meta: { sessionId: activeSessionId ?? question.sessionId } } } })

    await expect(page.getByText("Choose A or B")).toBeVisible({ timeout: 8_000 })
    await page.getByRole("radio", { name: "A" }).click()
    await page.getByTestId("artifact-surface").getByRole("button", { name: "Submit" }).click()

    await expect.poll(() => commands.some((cmd: any) => cmd.op === "ask-user.v1.answer" && cmd.input?.answerToken === "secret-e2e" && cmd.input?.values?.choice === "A")).toBe(true)
    await expect(page.getByText("Choose A or B")).toBeHidden({ timeout: 5_000 })
  })
})
