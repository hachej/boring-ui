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
  test("pending question appears in Inbox and survives page refresh", async ({ page }) => {
    let pendingRequestCount = 0
    const inboxQuestion = {
      ...question,
      questionId: "q-e2e-inbox-refresh",
      sessionId: "default",
      title: "Smoke check Inbox persistence",
      context: "This question should stay visible after browser refresh.",
    }

    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            "questions.pending": {
              hint: {
                questionId: inboxQuestion.questionId,
                sessionId: inboxQuestion.sessionId,
                status: "ready",
              },
            },
          },
        })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      if (body.op === "ask-user.v1.pending") {
        pendingRequestCount += 1
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e-inbox", output: { pending: inboxQuestion } } })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e-inbox", output: { ok: true, status: "answered" } } })
    })

    await page.goto("/?inboxDemo=1&fresh=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await expect(page.getByText("Smoke check Inbox persistence")).toBeVisible()
    await expect.poll(() => pendingRequestCount).toBeGreaterThanOrEqual(1)

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible()
    await expect(page.getByText("Smoke check Inbox persistence")).toBeVisible()
    await expect.poll(() => pendingRequestCount).toBeGreaterThanOrEqual(2)
  })

  test("target-scoped review action appears in file header and submits", async ({ page }) => {
    const commands: unknown[] = []
    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            "questions.pending": {
              hint: { questionId: "q-e2e-review", sessionId: "default", status: "ready" },
            },
          },
        })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      commands.push(body)
      if (body.op === "ask-user.v1.pending") {
        const sessionId = body.input?.sessionId ?? "default"
        await route.fulfill({
          json: {
            ok: true,
            op: body.op,
            requestId: "req-e2e-review",
            output: {
              pending: {
                ...question,
                questionId: "q-e2e-review",
                sessionId,
                title: "Review README",
                schema: {
                  wireVersion: 1,
                  fields: [{ type: "radio", name: "action", label: "Action", required: true, options: [{ value: "accept", label: "Accept" }, { value: "request_changes", label: "Request changes" }] }],
                },
                humanAction: {
                  kind: "review",
                  title: "Review README",
                  target: { type: "file", path: "README.md", label: "README.md" },
                  actions: [{ id: "accept", label: "Accept", tone: "positive" }],
                  actionFieldName: "action",
                },
              },
            },
          },
        })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e-review", output: { ok: true, status: "answered" } } })
    })

    await page.goto("/?fresh=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("textbox", { name: "Agent prompt" })).toBeVisible({ timeout: 15_000 })
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("boring-workspace:ui-command", { detail: { kind: "openFile", params: { path: "README.md" } } }))
    })
    await page.getByRole("complementary", { name: "Surface" }).getByText("README.md", { exact: true }).first().click({ force: true })

    await expect(page.getByRole("button", { name: "Review README: Accept" })).toBeVisible({ timeout: 15_000 })
    await page.getByRole("button", { name: "Review README: Accept" }).click({ force: true })

    await expect.poll(() => commands.some((cmd: any) => cmd.op === "ask-user.v1.answer" && cmd.input?.values?.action === "accept" && cmd.input?.answerToken === "secret-e2e")).toBe(true)
  })

  test("inbox review opens an HTML target and sends annotation payload back to the agent", async ({ page }) => {
    const commands: unknown[] = []
    const htmlReviewQuestion = {
      ...question,
      questionId: "q-e2e-html-review",
      sessionId: "default",
      title: "Review generated landing page",
      context: "Review the generated HTML artifact and request changes if needed.",
      schema: {
        wireVersion: 1,
        fields: [
          {
            type: "radio",
            name: "decision",
            label: "Decision",
            required: true,
            options: [
              { value: "accept", label: "Accept" },
              { value: "request_changes", label: "Request changes" },
            ],
          },
          { type: "textarea", name: "comment", label: "Human comment", maxLength: 4000 },
          { type: "textarea", name: "review", label: "LLM review handoff", maxLength: 4000 },
          { type: "textarea", name: "annotations", label: "Machine annotation payload", maxLength: 4000 },
        ],
      },
      humanAction: {
        id: "review-html-artifact",
        kind: "review",
        title: "Review generated landing page",
        body: "Check the generated HTML before the agent continues.",
        target: { type: "file", path: "docs/generated-review.html", label: "Generated HTML" },
        artifacts: [{ id: "generated-html", label: "Generated HTML", target: { type: "file", path: "docs/generated-review.html", label: "Generated HTML" } }],
        actions: [{ id: "request_changes", label: "Request changes", tone: "warning", comment: "required" }],
        actionFieldName: "decision",
        commentFieldName: "comment",
        reviewFieldName: "review",
        annotationsFieldName: "annotations",
      },
    }

    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: {
            "questions.pending": {
              hint: { questionId: htmlReviewQuestion.questionId, sessionId: htmlReviewQuestion.sessionId, status: "ready" },
            },
          },
        })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/files/raw?**", async (route) => {
      const url = new URL(route.request().url())
      if (url.searchParams.get("path") === "docs/generated-review.html") {
        await route.fulfill({
          contentType: "text/html",
          body: "<!doctype html><html><body><main><h1>Ship faster</h1><p>Signup now.</p></main></body></html>",
        })
        return
      }
      await route.continue()
    })

    await page.route("**/api/v1/workspace-bridge/call", async (route) => {
      const body = route.request().postDataJSON()
      commands.push(body)
      if (body.op === "ask-user.v1.pending") {
        await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e-html-review", output: { pending: htmlReviewQuestion } } })
        return
      }
      await route.fulfill({ json: { ok: true, op: body.op, requestId: "req-e2e-html-review", output: { ok: true, status: "answered" } } })
    })

    await page.goto("/?inboxDemo=1&fresh=1", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible({ timeout: 15_000 })
    const inboxRow = page.getByRole("button", { name: /Review generated landing page.*Generated HTML/ })
    await expect(inboxRow).toBeVisible()

    await inboxRow.click()
    await expect(page.getByRole("button", { name: "Review generated landing page: Request changes" })).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Review generated landing page: Request changes" }).click()
    await page.getByRole("textbox", { name: "Request changes comment" }).fill("CTA must explain pricing before signup.")
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => {
      const answer = commands.find((cmd: any) => cmd.op === "ask-user.v1.answer") as any
      return answer?.input?.values?.decision
    }).toBe("request_changes")

    const answer = commands.find((cmd: any) => cmd.op === "ask-user.v1.answer") as any
    expect(answer.input.answerToken).toBe("secret-e2e")
    expect(answer.input.values.comment).toBe("CTA must explain pricing before signup.")
    expect(answer.input.values.review).toContain("# Human Review Feedback")
    expect(answer.input.values.review).toContain("Decision: `request_changes`")
    expect(answer.input.values.review).toContain("Generated HTML")
    expect(answer.input.values.review).toContain("CTA must explain pricing before signup.")

    const reviewPayload = JSON.parse(answer.input.values.annotations)
    expect(reviewPayload).toMatchObject({
      humanActionId: "review-html-artifact",
      decisionId: "request_changes",
      comment: "CTA must explain pricing before signup.",
      annotations: [
        {
          target: { type: "file", path: "docs/generated-review.html", label: "Generated HTML" },
          anchor: { type: "global" },
          body: "CTA must explain pricing before signup.",
          severity: "issue",
        },
      ],
    })
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
    const workbenchButton = page.getByRole("button", { name: /^open workbench$/i })
    if (await workbenchButton.isVisible().catch(() => false)) await workbenchButton.click()
    await commandStreamReady
    const activeSessionId = await page.locator('[data-pi-chat-session-id]').first().getAttribute('data-pi-chat-session-id')
    await page.request.post("/api/v1/ui/commands", { data: { kind: "openSurface", params: { kind: "questions", target: question.questionId, meta: { sessionId: activeSessionId ?? question.sessionId } } } })

    await expect(page.getByRole("heading", { name: "Choose A or B" })).toBeVisible({ timeout: 8_000 })
    await page.getByRole("radio", { name: "A" }).click()
    await page.getByTestId("artifact-surface").getByRole("button", { name: "Submit" }).click()

    await expect.poll(() => commands.some((cmd: any) => cmd.op === "ask-user.v1.answer" && cmd.input?.answerToken === "secret-e2e" && cmd.input?.values?.choice === "A")).toBe(true)
    await expect(page.getByText("Choose A or B")).toBeHidden({ timeout: 5_000 })
  })
})
