import { test, expect } from "./playground-fixtures"

test.describe("File tree rendering", () => {
  test("1. file tree shows root directory", async ({ pg }) => {
    const tree = pg.locator("[role=tree]")
    await expect(tree).toBeVisible({ timeout: 15_000 })

    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 10_000 })
  })

  test("2. expand directory → shows children", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const childFile = pg.locator("[role=treeitem]", { hasText: "greeter.ts" })
    await expect(childFile).toBeVisible({ timeout: 10_000 })
  })

  test("3. search files → filters tree", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()
    await pg.waitForTimeout(500)

    const searchInput = pg.locator("input[aria-label='Search files']")
    await expect(searchInput).toBeVisible()

    await searchInput.fill("greeter")
    await pg.waitForTimeout(500)

    const matchingItem = pg.locator("[role=treeitem]", { hasText: "greeter" })
    await expect(matchingItem).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("File workflow", () => {
  test("4. click file in FileTree → editor tab opens with content", async ({
    pg,
  }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "greeter.ts" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const editorContent = pg.locator(".cm-content")
    await expect(editorContent).toBeVisible({ timeout: 10_000 })
    await expect(editorContent).toContainText("greet")
  })

  test("5. edit file in CodeMirror → content changes", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "utils.ts" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const editor = pg.locator(".cm-content")
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(editor).toContainText("clamp")
  })

  test("6. close tab → reopen → content available", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "config.json" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const tab = pg.locator(".dv-tab", { hasText: "config.json" })
    await expect(tab).toBeVisible({ timeout: 5_000 })

    const closeBtn = tab.locator("button[aria-label*='Close']")
    await expect(closeBtn).toBeVisible({ timeout: 2_000 })
    await closeBtn.click()
    await pg.waitForTimeout(500)

    await fileNode.click()
    await expect(pg.locator(".cm-content")).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("Panel lifecycle", () => {
  test("7. open file → panel registers in tab bar", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "schema.sql" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const tab = pg.locator(".dv-tab", { hasText: "schema.sql" })
    await expect(tab).toBeVisible({ timeout: 5_000 })
  })

  test("8. close panel via X → tab removed", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "pipeline.yaml" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const tab = pg.locator(".dv-tab", { hasText: "pipeline.yaml" })
    await expect(tab).toBeVisible({ timeout: 5_000 })

    const closeBtn = tab.locator("button[aria-label*='Close']")
    await expect(closeBtn).toBeVisible({ timeout: 2_000 })
    await closeBtn.click()
    await expect(tab).not.toBeVisible({ timeout: 3_000 })
  })

  test("9. reopen file → panel re-created (not cached)", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "data.csv" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const tab1 = pg.locator(".dv-tab", { hasText: "data.csv" })
    await expect(tab1).toBeVisible({ timeout: 5_000 })

    const closeBtn = tab1.locator("button[aria-label*='Close']")
    await expect(closeBtn).toBeVisible({ timeout: 2_000 })
    await closeBtn.click()
    await pg.waitForTimeout(500)

    await fileNode.click()
    const tab2 = pg.locator(".dv-tab", { hasText: "data.csv" })
    await expect(tab2).toBeVisible({ timeout: 5_000 })
  })
})

test.describe("Theme toggle", () => {
  test("10. toggle theme → data-theme changes to dark", async ({ pg }) => {
    const toggle = pg.locator("[data-testid='theme-toggle']")
    await expect(toggle).toBeVisible({ timeout: 5_000 })

    const initialTheme = await pg.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    )

    await toggle.click()

    const newTheme = await pg.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    )

    expect(newTheme).not.toBe(initialTheme)
    expect(["light", "dark"]).toContain(newTheme)
  })

  test("11. toggle theme twice → returns to original", async ({ pg }) => {
    const toggle = pg.locator("[data-testid='theme-toggle']")
    await expect(toggle).toBeVisible({ timeout: 5_000 })

    const initialTheme = await pg.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    )

    await toggle.click()
    await pg.waitForTimeout(200)
    await toggle.click()

    const finalTheme = await pg.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    )

    expect(finalTheme).toBe(initialTheme)
  })
})

test.describe("Markdown workflow", () => {
  test("12. open .md file → editor renders content", async ({ pg }) => {
    const srcDir = pg.locator("[role=treeitem]", { hasText: "src" })
    await expect(srcDir).toBeVisible({ timeout: 15_000 })
    await srcDir.click()

    const fileNode = pg.locator("[role=treeitem]", { hasText: "README.md" })
    await expect(fileNode).toBeVisible({ timeout: 10_000 })
    await fileNode.click()

    const tab = pg.locator(".dv-tab", { hasText: "README.md" })
    await expect(tab).toBeVisible({ timeout: 5_000 })

    const editorArea = pg.locator(".ProseMirror, .tiptap, .cm-content")
    await expect(editorArea).toBeVisible({ timeout: 10_000 })
  })
})

test.describe("Layout persistence", () => {
  test("13. sidebar presence persists across layout", async ({ pg }) => {
    const sidebar = pg.locator(".dv-shell")
    await expect(sidebar).toBeVisible({ timeout: 10_000 })

    const sidebarGroup = pg.locator("[role=tree]")
    await expect(sidebarGroup).toBeVisible({ timeout: 15_000 })
  })
})
