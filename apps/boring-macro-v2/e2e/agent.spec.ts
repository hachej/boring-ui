import { expect, test } from "@playwright/test"

/**
 * The agent catalog is the contract surface between Claude and the macro
 * app. Any drift here is a regression. We assert names + minimal shape.
 */
test("/api/v1/agent/catalog lists workspace UI tools + macro tools", async ({ request }) => {
  const res = await request.get("/api/v1/agent/catalog")
  expect(res.ok()).toBe(true)
  const body = await res.json()
  const names = body.tools.map((t: { name: string }) => t.name)

  // Workspace UI bridge tools (added by @hachej/boring-workspace/app/server).
  expect(names).toContain("exec_ui")
  expect(names).toContain("get_ui_state")

  // Macro tools (added via extraTools).
  expect(names).toContain("execute_sql")
  expect(names).toContain("macro_search")
  expect(names).toContain("get_series_data")
  expect(names).toContain("persist_derived_series")

  // open_series was deliberately removed in favor of exec_ui.
  expect(names).not.toContain("open_series")
})

test("UI bridge accepts an openPanel command", async ({ request }) => {
  const res = await request.post("/api/v1/ui/commands", {
    headers: { "Content-Type": "application/json" },
    data: {
      kind: "openPanel",
      params: {
        id: "chart:e2e-test",
        component: "chart-canvas",
        params: { seriesId: "GDPC1" },
      },
    },
  })
  expect(res.ok()).toBe(true)
  const body = await res.json()
  expect(body.status).toBe("ok")
  expect(typeof body.seq).toBe("number")
})
