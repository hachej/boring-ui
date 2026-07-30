import { expect, test, type APIRequestContext } from "@playwright/test"

const expectedSkills = ["workspace-review", "bi-dashboard-authoring", "company-review"]

async function setCompanySkillsReadable(request: APIRequestContext, readable: boolean) {
  const response = await request.post("/api/v1/playground/company-skills", { data: { readable } })
  expect(response.ok()).toBe(true)
}

test.beforeEach(async ({ request }) => {
  test.skip(process.env.BORING_SKILL_RESOURCE_E2E !== "1", "Run with pnpm --filter workspace-playground test:e2e:skills")
  await setCompanySkillsReadable(request, true)
})

test.afterEach(async ({ request }) => {
  if (process.env.BORING_SKILL_RESOURCE_E2E === "1") await setCompanySkillsReadable(request, true)
})

test("exposes safe skill resources and enforces readonly mutations", async ({ request }) => {
  const catalogResponse = await request.get("/api/v1/agent/skills?refresh=1")
  expect(catalogResponse.ok()).toBe(true)
  const catalogText = await catalogResponse.text()
  const catalog = JSON.parse(catalogText) as { skills: Array<{
    name: string
    invocable?: boolean
    invocation?: string
    resource?: { filesystem: string; path: string }
  }> }

  expect(catalogText).not.toContain("node_modules")
  expect(catalogText).not.toContain("filePath")
  expect(catalogText).not.toContain("/home/")
  expect(catalog.skills).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: "workspace-review",
      resource: { filesystem: "user", path: ".agents/skills/workspace-review/SKILL.md" },
    }),
    expect.objectContaining({
      name: "bi-dashboard-authoring",
      resource: {
        filesystem: "agent_resources",
        path: "packages/@hachej/boring-bi-dashboard/skills/bi-dashboard-authoring/SKILL.md",
      },
    }),
    expect.objectContaining({
      name: "company-review",
      invocable: true,
      invocation: "filesystem",
      resource: { filesystem: "company_context", path: ".agents/skills/company-review/SKILL.md" },
    }),
    expect.objectContaining({
      name: "workspace-review",
      invocable: false,
      resource: { filesystem: "company_context", path: ".agents/skills/workspace-review/SKILL.md" },
    }),
  ]))

  const reviewedRows = catalog.skills.filter((skill) => expectedSkills.includes(skill.name))
  expect(reviewedRows).toHaveLength(4)
  for (const name of expectedSkills) {
    expect(reviewedRows.filter((skill) => skill.name === name && skill.invocable !== false)).toHaveLength(1)
  }
  expect(reviewedRows.find((skill) => skill.name === "workspace-review" && skill.invocable !== false)?.resource?.filesystem).toBe("user")

  for (const resource of [
    { filesystem: "user", path: ".agents/skills/workspace-review/SKILL.md" },
    { filesystem: "company_context", path: ".agents/skills/company-review/SKILL.md" },
    {
      filesystem: "agent_resources",
      path: "packages/@hachej/boring-bi-dashboard/skills/bi-dashboard-authoring/SKILL.md",
    },
  ]) {
    const read = await request.get("/api/v1/files", { params: resource })
    expect(read.status()).toBe(200)
    const originalContent = await read.text()
    expect((await request.get("/api/v1/stat", { params: resource })).status()).toBe(200)

    const readonlyResponses = [
      await request.post("/api/v1/files", { data: { ...resource, content: "changed" } }),
      await request.delete("/api/v1/files", { params: resource }),
      await request.post("/api/v1/files/move", {
        data: { filesystem: resource.filesystem, from: resource.path, to: `${resource.path}.moved` },
      }),
      await request.post("/api/v1/dirs", {
        data: { filesystem: resource.filesystem, path: `${resource.path}.dir`, recursive: true },
      }),
    ]
    for (const response of readonlyResponses) {
      expect(response.status()).toBe(403)
      const body = await response.text()
      expect(body).toContain('"code":"readonly"')
      expect(body).not.toContain("/home/")
    }
    const unchanged = await request.get("/api/v1/files", { params: resource })
    expect(unchanged.status()).toBe(200)
    expect(await unchanged.text()).toBe(originalContent)
    expect((await request.get("/api/v1/stat", {
      params: { filesystem: resource.filesystem, path: `${resource.path}.moved` },
    })).status()).toBe(404)
    expect((await request.get("/api/v1/stat", {
      params: { filesystem: resource.filesystem, path: `${resource.path}.dir` },
    })).status()).toBe(404)
  }

  for (const attempt of [
    { filesystem: "company_context", path: "../outside.txt" },
    { filesystem: "agent_resources", path: "../outside.txt" },
    { filesystem: "agent_resources", path: "/etc/passwd" },
  ]) {
    const response = await request.get("/api/v1/files", { params: attempt })
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect(await response.text()).not.toContain("/home/")
  }

  const userWrite = await request.post("/api/v1/files", {
    data: { filesystem: "user", path: "skill-review-e2e.txt", content: "editable" },
  })
  expect(userWrite.status()).toBe(200)
  const userRead = await request.get("/api/v1/files", {
    params: { filesystem: "user", path: "skill-review-e2e.txt" },
  })
  expect(userRead.status()).toBe(200)
  await request.delete("/api/v1/files", { params: { filesystem: "user", path: "skill-review-e2e.txt" } })
})

test("connects the real skill catalog to composer invocation and revocation", async ({ page, request }) => {
  const consoleErrors: string[] = []
  const submittedMessages: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() !== "POST" || (!path.endsWith("/prompt") && !path.endsWith("/followup"))) return
    const payload = request.postDataJSON() as { content?: unknown; message?: unknown }
    const message = typeof payload.content === "string" ? payload.content : payload.message
    if (typeof message === "string") submittedMessages.push(message)
  })
  page.on("console", (message) => {
    if (message.type() === "error" && /unique.*key|same key/i.test(message.text())) consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  await page.goto("/?fresh=1")
  await page.getByRole("button", { name: "Open workbench" }).click()
  await expect(page.getByRole("button", { name: "Files", exact: true })).toHaveCount(1)
  await page.getByRole("button", { name: "Files", exact: true }).click()
  const fileRoot = page.getByRole("combobox", { name: "File root" })
  await expect(fileRoot).toBeVisible()
  await fileRoot.click()
  await page.getByRole("option", { name: "Company" }).click()
  await expect(fileRoot).toContainText("Company")
  await page.getByRole("treeitem", { name: "policy.md" }).click()
  await expect(page.getByText("Company review policy", { exact: true })).toBeVisible()

  await fileRoot.click()
  await page.getByRole("option", { name: "Workspace" }).click()
  await page.getByRole("treeitem", { name: "README.md" }).click()
  await expect(page.getByText("Workspace Playground", { exact: true })).toBeVisible()

  await page.getByText("Skills", { exact: true }).first().click()
  await expect(page.getByRole("button", { name: /Open skill workspace-review from/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Open skill bi-dashboard-authoring from/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Open skill company-review from company_context" })).toBeVisible()
  const managementSource = page.getByRole("button", { name: "Open management source workspace-review from company_context" })
  await expect(managementSource).toBeVisible()
  await expect(page.getByText("Management source", { exact: true })).toHaveCount(1)
  await managementSource.click()

  await page.goto("/?fresh=1&chat=1")
  const composer = page.getByLabel("Agent prompt")
  await expect(composer).toBeVisible()
  await composer.fill("/")
  const commands = page.getByRole("listbox", { name: "Commands" })
  for (const skill of expectedSkills) await expect(commands.getByText(`/${skill}`, { exact: true })).toBeVisible()
  await expect(commands.getByText("/workspace-review", { exact: true })).toHaveCount(1)

  await composer.fill("/workspace-review winner")
  await composer.press("Enter")
  await expect.poll(() => submittedMessages.length).toBe(1)
  expect(submittedMessages[0]).toContain("skill: workspace-review")
  expect(submittedMessages[0]).toContain("winner")
  expect(submittedMessages[0]).not.toContain("Company workspace review")
  await expect(page.getByText("PI_NATIVE_ASSISTANT_DONE", { exact: true })).toBeVisible({ timeout: 15_000 })

  const authorizedRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.status() === 200
      && url.pathname === "/api/v1/files"
      && url.searchParams.get("filesystem") === "company_context"
      && url.searchParams.get("path") === ".agents/skills/company-review/SKILL.md"
  })
  await composer.fill("/company-review policy.md")
  await composer.press("Enter")
  await authorizedRead
  await expect.poll(() => submittedMessages.length).toBe(2)
  expect(submittedMessages[1]).toContain('"filesystem":"company_context"')
  expect(submittedMessages[1]).toContain("User request:\npolicy.md")

  await setCompanySkillsReadable(request, false)
  const deniedRead = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.status() >= 400
      && url.pathname === "/api/v1/files"
      && url.searchParams.get("filesystem") === "company_context"
      && url.searchParams.get("path") === ".agents/skills/company-review/SKILL.md"
  })
  await composer.fill("/company-review revoked")
  await composer.press("Enter")
  await deniedRead
  await expect(page.getByText("Skill is no longer available.", { exact: true })).toBeVisible()
  expect(submittedMessages).toHaveLength(2)

  await page.reload()
  const reloadedComposer = page.getByLabel("Agent prompt")
  await reloadedComposer.fill("/")
  const reloadedCommands = page.getByRole("listbox", { name: "Commands" })
  await expect(reloadedCommands.getByText("/company-review", { exact: true })).toHaveCount(0)
  await expect(reloadedCommands.getByText("/workspace-review", { exact: true })).toHaveCount(1)
  await expect(reloadedCommands.getByText("/bi-dashboard-authoring", { exact: true })).toBeVisible()

  await page.getByText("Skills", { exact: true }).first().click()
  await expect(page.getByRole("button", { name: /Open skill workspace-review from/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Open skill bi-dashboard-authoring from/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /company-review/ })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
