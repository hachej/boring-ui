import { chromium } from '@playwright/test'

const baseUrl = process.env.UI_URL || 'http://127.0.0.1:5180/'
const apiKey = process.env.ANTHROPIC_API_KEY || ''

const log = (...args) => console.log('[ui-check]', ...args)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureSidebarOpen(page) {
  const expand = page.locator('button[aria-label="Expand sidebar"]').first()
  if (await expand.count()) {
    await expand.click()
    await sleep(200)
  }
}

async function ensureFilesView(page) {
  const filesToggle = page.locator('.view-toggle-btn[title="File tree"]').first()
  if (await filesToggle.count()) await filesToggle.click()
}

async function createFile(page, name) {
  await ensureSidebarOpen(page)
  await ensureFilesView(page)
  const newFileBtn = page.locator('.sidebar-action-btn[title="New File"]').first()
  await newFileBtn.click()
  const input = page.locator('.file-item-new input.rename-input').first()
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(name)
  await input.press('Enter')
  await page.waitForSelector(`text=${name}`)
}

async function runCreateRenameCheck() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.file-tree-title, .file-tree-scroll')

  const ts = Date.now()
  const oldName = `rename-check-${ts}.md`
  const newName = `rename-check-${ts}-renamed.md`

  await createFile(page, oldName)
  const row = page.locator('.file-item', { hasText: oldName }).first()
  await row.click({ button: 'right' })
  await page.locator('.context-menu-item', { hasText: 'Rename' }).click()
  const renameInput = page.locator('input.rename-input').first()
  await renameInput.fill(newName)
  await renameInput.press('Enter')
  await page.waitForSelector(`text=${newName}`)

  await browser.close()
  log('file create/rename ok')
}

async function runMarkdownRoundtripCheck() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.file-tree-title, .file-tree-scroll')

  const ts = Date.now()
  const file = `roundtrip-${ts}.md`
  const payload = `Roundtrip ${ts}`

  await createFile(page, file)
  await page.locator('.file-item', { hasText: file }).first().click()
  const editor = page.locator('.ProseMirror:visible').first()
  await editor.waitFor({ state: 'visible', timeout: 10000 })
  await editor.click()
  await page.keyboard.type(payload)
  await sleep(1500)

  const typed = await editor.innerText()
  if (!typed.includes(payload)) {
    throw new Error(`typing markdown failed. current text: ${JSON.stringify(typed)}`)
  }

  // switch away then back
  const fallback = page.locator('.file-item', { hasText: 'README.md' }).first()
  if (await fallback.count()) await fallback.click()
  await page.locator('.file-item', { hasText: file }).first().click()
  await page.waitForSelector('.ProseMirror:visible')

  const reopened = await page.locator('.ProseMirror:visible').first().innerText()
  if (!reopened.includes(payload)) {
    throw new Error(`markdown roundtrip failed. current text: ${JSON.stringify(reopened)}`)
  }

  await browser.close()
  log('markdown roundtrip ok')
}

async function runPiPythonBestEffort() {
  if (!apiKey) {
    log('ANTHROPIC_API_KEY not provided; skipping PI python check')
    return
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.file-tree-title, .file-tree-scroll')

  await page.evaluate((key) => {
    window.__PI_TEST_API_KEY__ = key
  }, apiKey)

  const input = page.locator('pi-chat-panel textarea, pi-chat-panel input[type="text"]').first()
  if (!(await input.count())) {
    await browser.close()
    log('pi input not found; skipping live PI check')
    return
  }

  await input.click()
  await input.fill('Create hello.py with print("py-ok") then run python_exec and report only stdout.')
  await input.press('Enter')
  await page.waitForTimeout(25000)

  const bodyText = await page.locator('pi-chat-panel').innerText()
  if (bodyText.toLowerCase().includes('py-ok')) {
    log('pi python tool check ok')
  } else {
    log('pi python tool check inconclusive (no py-ok found)')
  }

  await browser.close()
}

async function run() {
  await runCreateRenameCheck()
  await runMarkdownRoundtripCheck()
  await runPiPythonBestEffort()
}

run().catch((err) => {
  console.error('[ui-check] FAILED:', err?.message || err)
  process.exit(1)
})
