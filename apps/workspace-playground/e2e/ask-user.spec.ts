import { expect, test } from "@playwright/test"

const question = {
  questionId: "q-e2e",
  sessionId: "default",
  ownerPrincipalId: "anonymous",
  status: "ready",
  title: "Choose A or B",
  context: "Please select one option.",
  draftVersion: 0,
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
  test("ui command opens pane from metadata, acks opened, submits, and closes", async ({ page }) => {
    const commands: unknown[] = []
    await page.addInitScript((q) => {
      class MockEventSource extends EventTarget {
        url: string
        readyState = 1
        withCredentials = false
        CONNECTING = 0
        OPEN = 1
        CLOSED = 2
        constructor(url: string) {
          super()
          this.url = url
          setTimeout(() => {
            this.dispatchEvent(new MessageEvent("init", { data: "{}" }))
            this.dispatchEvent(new MessageEvent("command", { data: JSON.stringify({ kind: "openSurface", params: { kind: "questions", target: q.questionId, meta: { question: q } } }) }))
          }, 250)
        }
        close() { this.readyState = 2 }
      }
      Object.defineProperty(window, "EventSource", { value: MockEventSource, configurable: true })
    }, question)

    await page.route("**/api/v1/ui/state", async (route) => {
      if (route.request().method() === "GET") {
        // Regression guard: even if state polling has not caught up yet, the
        // openSurface metadata must be enough to render the live form.
        await route.fulfill({ json: {} })
        return
      }
      await route.fulfill({ status: 204 })
    })

    await page.route("**/api/v1/questions/commands", async (route) => {
      const body = route.request().postDataJSON()
      commands.push(body)
      await route.fulfill({ json: { ok: true, status: body.kind === "questions.submit" ? "answered" : "opened" } })
    })

    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page.getByText("Choose A or B")).toBeVisible({ timeout: 8_000 })
    await expect.poll(() => commands.some((cmd: any) => cmd.kind === "questions.opened")).toBe(true)

    await page.getByRole("radio", { name: "A" }).click()
    await page.getByTestId("artifact-surface").getByRole("button", { name: "Submit" }).click()

    await expect.poll(() => commands.some((cmd: any) => cmd.kind === "questions.submit" && cmd.params?.answerToken === "secret-e2e" && cmd.params?.values?.choice === "A")).toBe(true)
    await expect(page.getByText("Choose A or B")).toBeHidden({ timeout: 5_000 })
  })
})
