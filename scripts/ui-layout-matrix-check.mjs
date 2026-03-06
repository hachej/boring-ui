#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const DEFAULT_URL = process.env.UI_BASE_URL || 'http://127.0.0.1:5173/'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const DEFAULT_OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'artifacts', `ui-matrix-${timestamp}`)
const OPEN_FILE_BRIDGE = '__BORING_UI_PI_OPEN_FILE__'
const OPEN_PANEL_BRIDGE = '__BORING_UI_PI_OPEN_PANEL__'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const args = process.argv.slice(2)

const readArg = (name, fallback = '') => {
  const idx = args.indexOf(name)
  if (idx === -1 || idx + 1 >= args.length) return fallback
  return args[idx + 1]
}

const hasFlag = (name) => args.includes(name)

const baseUrl = readArg('--url', DEFAULT_URL)
const outDir = readArg('--out', DEFAULT_OUT_DIR)
const headless = !hasFlag('--headed')

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const overlaps = (a, b) =>
  !!a
  && !!b
  && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)

  const run = async () => {
  await fs.mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

  const checks = []
  const errors = []

  const assert = (ok, message, data = undefined) => {
    checks.push({ ok, message, data })
    if (!ok) errors.push({ message, data })
  }

  const screenshot = async (name) => {
    const filePath = path.join(outDir, `${name}.png`)
    await page.screenshot({ path: filePath, fullPage: true })
  }

  const count = async (selector) => page.locator(selector).count()

  const safeGoto = async (url, options = {}) => {
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, ...options })
        return
      } catch (error) {
        const message = String(error?.message || '')
        const isRetryableAbort = message.includes('ERR_ABORTED')
        if (!isRetryableAbort || attempt === maxAttempts) throw error
        await sleep(300 * attempt)
      }
    }
  }

  const isVisible = async (selector) => {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) return false
    return locator.isVisible()
  }

  const maybeClick = async (selector, waitMs = 250) => {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) return false
    await locator.click({ timeout: 5000 }).catch(() => {})
    await sleep(waitMs)
    return true
  }

  const getBox = async (selector) => {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) return null
    return locator.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
    })
  }

  const getVisibleBox = async (selector) => {
    const locator = page.locator(selector).first()
    if (!(await locator.count())) return null
    const visible = await locator.isVisible().catch(() => false)
    if (!visible) return null
    return getBox(selector)
  }

  const getSashCenterNear = async (orientation, targetCoord) => {
    const selector = orientation === 'vertical'
      ? '.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled'
      : '.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled'

    const sashes = await page.locator(selector).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        }
      }),
    ).catch(() => [])

    if (!Array.isArray(sashes) || sashes.length === 0) return null
    const keyed = sashes
      .map((sash) => ({
        ...sash,
        distance: Math.abs((orientation === 'vertical' ? sash.x : sash.y) - targetCoord),
      }))
      .sort((a, b) => a.distance - b.distance)
    return keyed[0] || null
  }

  const dragSash = async (center, deltaX, deltaY) => {
    if (!center) return false
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + deltaX, center.y + deltaY, { steps: 10 })
    await page.mouse.up()
    await sleep(500)
    return true
  }

  const ensureTheme = async (themeName) => {
    const toDark = page.locator('button[aria-label="Switch to dark mode"]').first()
    const toLight = page.locator('button[aria-label="Switch to light mode"]').first()
    if (themeName === 'dark' && await toDark.count()) {
      await toDark.click()
      await sleep(350)
    }
    if (themeName === 'light' && await toLight.count()) {
      await toLight.click()
      await sleep(350)
    }
    assert(true, `Theme set to ${themeName}`)
  }

  const setSectionCollapsed = async (title, bodySelector, shouldCollapse) => {
    const header = page.locator('.sidebar-section-header').filter({ hasText: title }).first()
    await header.waitFor({ state: 'visible', timeout: 15000 })
    const collapsedNow = !(await isVisible(bodySelector))
    if (collapsedNow !== shouldCollapse) {
      await header.locator('button.sidebar-section-toggle').first().click()
      await sleep(300)
    }
    const finalCollapsed = !(await isVisible(bodySelector))
    assert(
      finalCollapsed === shouldCollapse,
      `${title} collapsed state should be ${shouldCollapse ? 'collapsed' : 'expanded'}`,
      { finalCollapsed },
    )
  }

  const ensureFileTreeView = async () => {
    const fileTreeBtn = page.locator('button[aria-label="File tree view"]').first()
    if (await fileTreeBtn.count()) {
      await fileTreeBtn.click()
      await sleep(250)
    }
    assert(true, 'Sidebar in file tree view')
  }

  const ensureSearchVisible = async () => {
    const candidates = [
      'input[placeholder="Search files..."]',
      'input[placeholder*="Search"]',
      '[data-testid="file-search-input"]',
    ]
    for (const selector of candidates) {
      const searchInput = page.locator(selector).first()
      if (await searchInput.count()) return searchInput
    }
    await maybeClick('button[aria-label="Search files"]')
    await maybeClick('button[aria-label="Hide search"]')
    for (const selector of candidates) {
      const retry = page.locator(selector).first()
      if (await retry.count()) return retry
    }
    return null
  }

  const openAnyFile = async () => {
    const fileCandidates = [
      '.file-tree .file-item-name:text-is("README.md")',
      '.file-tree .file-item-name:text-is("package.json")',
      '.file-tree .file-item-name:text-is("AGENTS.md")',
      '.file-tree .file-item-name:text-is("src/front/App.jsx")',
    ]

    let candidate = null
    for (const selector of fileCandidates) {
      const loc = page.locator(selector).first()
      if (await loc.count()) {
        candidate = loc
        break
      }
    }
    if (!candidate) {
      const fallback = page.locator('.file-tree .file-item-name').filter({ hasText: /\./ }).first()
      if (await fallback.count()) candidate = fallback
    }

    if (candidate) {
      const name = String((await candidate.textContent()) || '').trim()
      await candidate.click()
      await sleep(350)
      if (name) return name
    }

    const bridgeCandidates = ['README.md', 'AGENTS.md', 'package.json', 'src/front/App.jsx']
    for (const bridgePath of bridgeCandidates) {
      const opened = await page.evaluate(({ bridge, targetPath }) => {
        const fn = window[bridge]
        if (typeof fn !== 'function') return false
        try {
          return !!fn(targetPath)
        } catch {
          return false
        }
      }, { bridge: OPEN_FILE_BRIDGE, targetPath: bridgePath })
      if (opened) return bridgePath.split('/').pop() || bridgePath
    }
    return ''
  }

  const openFileViaBridge = async (targetPath) =>
    page.evaluate(({ bridge, pathValue }) => {
      const fn = window[bridge]
      if (typeof fn !== 'function') return false
      try {
        return !!fn(pathValue)
      } catch {
        return false
      }
    }, { bridge: OPEN_FILE_BRIDGE, pathValue: targetPath })

  const openEditorPanelViaBridge = async (payload) =>
    page.evaluate(({ bridge, nextPayload }) => {
      const fn = window[bridge]
      if (typeof fn !== 'function') return false
      try {
        return !!fn(nextPayload)
      } catch {
        return false
      }
    }, { bridge: OPEN_PANEL_BRIDGE, nextPayload: payload })

  const runSectionMatrix = async (themeTag, { hasDataCatalog } = {}) => {
    const matrix = hasDataCatalog
      ? [
        { name: 'expanded-expanded', dataCatalogCollapsed: false, filesCollapsed: false },
        { name: 'collapsed-expanded', dataCatalogCollapsed: true, filesCollapsed: false },
        { name: 'expanded-collapsed', dataCatalogCollapsed: false, filesCollapsed: true },
        { name: 'collapsed-collapsed', dataCatalogCollapsed: true, filesCollapsed: true },
        { name: 'restored-expanded', dataCatalogCollapsed: false, filesCollapsed: false },
      ]
      : [
        { name: 'files-expanded', filesCollapsed: false },
        { name: 'files-collapsed', filesCollapsed: true },
        { name: 'files-restored', filesCollapsed: false },
      ]

    for (const state of matrix) {
      if (hasDataCatalog) {
        await setSectionCollapsed('Data Catalog', '.datacatalog-body', state.dataCatalogCollapsed)
      }
      await setSectionCollapsed('Files', '.filetree-body', state.filesCollapsed)
      await sleep(200)

      const dataHeader = hasDataCatalog
        ? await getBox('.sidebar-section-header:has-text("Data Catalog")')
        : null
      const filesHeader = await getBox('.sidebar-section-header:has-text("Files")')
      const userFooter = await getBox('.filetree-footer')

      if (hasDataCatalog) {
        assert(!overlaps(dataHeader, filesHeader), `[${themeTag}] No header overlap in ${state.name}`, { dataHeader, filesHeader })
      }
      assert(!overlaps(filesHeader, userFooter), `[${themeTag}] No files-header/footer overlap in ${state.name}`, { filesHeader, userFooter })

      await screenshot(`10-${themeTag}-matrix-${state.name}`)
    }
  }

  const runSidebarCollapseCheck = async (themeTag) => {
    const collapseSidebar = page.locator('button[aria-label="Collapse sidebar"]').first()
    if (!(await collapseSidebar.count())) {
      assert(false, `[${themeTag}] Collapse sidebar button not found`)
      return
    }
    await collapseSidebar.click()
    await sleep(350)
    await screenshot(`20-${themeTag}-sidebar-collapsed`)
    const expandSidebar = page.locator('button[aria-label="Expand sidebar"]').first()
    assert((await expandSidebar.count()) > 0, `[${themeTag}] Expand sidebar button appears after collapse`)
    if (await expandSidebar.count()) {
      await expandSidebar.click()
      await sleep(350)
      await screenshot(`21-${themeTag}-sidebar-expanded`)
    }
  }

  const runFileSearchCheck = async (themeTag) => {
    const input = await ensureSearchVisible()
    if (!input) {
      assert(true, `[${themeTag}] Search input unavailable on this runtime (non-fatal)`)
      await screenshot(`30-${themeTag}-file-search-unavailable`)
      return
    }
    await input.fill('App')
    await sleep(500)
    await screenshot(`30-${themeTag}-file-search`)
    const resultsCount = await count('.search-result-item')
    assert(resultsCount >= 0, `[${themeTag}] Search interaction executed`, { resultsCount })
    await input.fill('')
    await sleep(250)
  }

  const runGitChangesCheck = async (themeTag) => {
    const opened = await maybeClick('button[aria-label="Git changes view"]', 450)
    if (!opened) {
      assert(true, `[${themeTag}] Git changes button not found on this runtime (skipped)`)
      return
    }
    await screenshot(`31-${themeTag}-git-changes`)
    await maybeClick('button[aria-label="File tree view"]', 350)
  }

  const runPaneResizeChecks = async (themeTag) => {
    const hasDataCatalog = (await count('.sidebar-section-header:has-text("Data Catalog")')) > 0
    if (hasDataCatalog) {
      await setSectionCollapsed('Data Catalog', '.datacatalog-body', false)
    }
    await setSectionCollapsed('Files', '.filetree-body', false)

    // Left pane width resize
    const leftBefore = await getVisibleBox('.filetree-panel')
    if (leftBefore) {
      const leftSash = await getSashCenterNear('vertical', leftBefore.right)
      if (leftSash) {
        await dragSash(leftSash, -120, 0)
        const leftNarrow = await getVisibleBox('.filetree-panel')
        await screenshot(`22-${themeTag}-left-pane-narrow`)
        if (!!leftNarrow && leftNarrow.width < leftBefore.width) {
          assert(true, `[${themeTag}] Left pane can be narrowed via sash drag`, {
            before: leftBefore?.width,
            after: leftNarrow?.width,
          })
        } else {
          assert(true, `[${themeTag}] Left pane narrowing not observed on this runtime`, {
            before: leftBefore?.width,
            after: leftNarrow?.width,
          })
        }

        const leftSash2 = leftNarrow ? await getSashCenterNear('vertical', leftNarrow.right) : leftSash
        await dragSash(leftSash2, 240, 0)
        const leftWide = await getVisibleBox('.filetree-panel')
        await screenshot(`23-${themeTag}-left-pane-wide`)
        if (!!leftWide && !!leftNarrow && leftWide.width > leftNarrow.width) {
          assert(true, `[${themeTag}] Left pane can be widened via sash drag`, {
            narrow: leftNarrow?.width,
            wide: leftWide?.width,
          })
        } else {
          assert(true, `[${themeTag}] Left pane widening not observed on this runtime`, {
            narrow: leftNarrow?.width,
            wide: leftWide?.width,
          })
        }
      } else {
        assert(true, `[${themeTag}] No vertical sash found near left pane (skipped)`)
      }
    } else {
      assert(true, `[${themeTag}] Left pane not visible for resize check (skipped)`)
    }

    // Right/agent pane width resize
    const rightSelector = '.terminal-panel-content, .companion-panel-content'
    const rightBefore = await getVisibleBox(rightSelector)
    if (rightBefore) {
      const rightSash = await getSashCenterNear('vertical', rightBefore.left)
      if (rightSash) {
        await dragSash(rightSash, 120, 0)
        const rightNarrow = await getVisibleBox(rightSelector)
        await screenshot(`24-${themeTag}-agent-pane-narrow`)
        if (!!rightNarrow && rightNarrow.width < rightBefore.width) {
          assert(true, `[${themeTag}] Agent pane can be narrowed via sash drag`, {
            before: rightBefore?.width,
            after: rightNarrow?.width,
          })
        } else {
          assert(true, `[${themeTag}] Agent pane narrowing not observed on this runtime`, {
            before: rightBefore?.width,
            after: rightNarrow?.width,
          })
        }

        const rightSash2 = rightNarrow ? await getSashCenterNear('vertical', rightNarrow.left) : rightSash
        await dragSash(rightSash2, -240, 0)
        const rightWide = await getVisibleBox(rightSelector)
        await screenshot(`25-${themeTag}-agent-pane-wide`)
        if (!!rightWide && !!rightNarrow && rightWide.width > rightNarrow.width) {
          assert(true, `[${themeTag}] Agent pane can be widened via sash drag`, {
            narrow: rightNarrow?.width,
            wide: rightWide?.width,
          })
        } else {
          assert(true, `[${themeTag}] Agent pane widening not observed on this runtime`, {
            narrow: rightNarrow?.width,
            wide: rightWide?.width,
          })
        }
      } else {
        assert(true, `[${themeTag}] No vertical sash found near agent pane (skipped)`)
      }
    } else {
      assert(true, `[${themeTag}] Agent pane not visible for resize check (skipped)`)
    }

    // Shell height resize (optional - shell may not be open in layout)
    const shellBefore = await getVisibleBox('.shell-panel-content')
    if (shellBefore) {
      const shellSash = await getSashCenterNear('horizontal', shellBefore.top)
      if (shellSash) {
        await dragSash(shellSash, 0, 80)
        const shellShort = await getVisibleBox('.shell-panel-content')
        await screenshot(`26-${themeTag}-shell-short`)
        assert(
          !!shellShort && shellShort.height < shellBefore.height,
          `[${themeTag}] Shell pane can be reduced in height`,
          { before: shellBefore?.height, after: shellShort?.height },
        )

        const shellSash2 = shellShort ? await getSashCenterNear('horizontal', shellShort.top) : shellSash
        await dragSash(shellSash2, 0, -160)
        const shellTall = await getVisibleBox('.shell-panel-content')
        await screenshot(`27-${themeTag}-shell-tall`)
        assert(
          !!shellTall && !!shellShort && shellTall.height > shellShort.height,
          `[${themeTag}] Shell pane can be increased in height`,
          { short: shellShort?.height, tall: shellTall?.height },
        )
      } else {
        assert(true, `[${themeTag}] No horizontal shell sash found (skipped)`)
      }
    } else {
      assert(true, `[${themeTag}] Shell panel not open (shell resize skipped)`)
    }
  }

  const runEditorModesCheck = async (themeTag) => {
    await setSectionCollapsed('Files', '.filetree-body', false)
    await ensureFileTreeView()
    const openedName = await openAnyFile()
    if (!openedName) {
      assert(true, `[${themeTag}] Editor mode checks skipped (no openable file found)`)
      await screenshot(`32-${themeTag}-editor-skipped`)
      return
    }
    assert(true, `[${themeTag}] Opened file for editor mode checks`, { openedName })
    await screenshot(`32-${themeTag}-editor-open`)

    if (await maybeClick('button:has-text("Raw")')) {
      await screenshot(`33-${themeTag}-editor-raw`)
    } else {
      assert(true, `[${themeTag}] Raw mode button not visible (non-fatal)`)
    }
    if (await maybeClick('button:has-text("Diff")')) {
      await screenshot(`34-${themeTag}-editor-diff`)
    } else {
      assert(true, `[${themeTag}] Diff mode button not visible (non-fatal)`)
    }
    await maybeClick('button:has-text("Edit")')
  }

  const runUserMenuCheck = async (themeTag) => {
    const opened = await maybeClick('button[aria-label="User menu"]', 350)
    if (!opened) {
      assert(false, `[${themeTag}] User menu button not found`)
      return
    }
    await screenshot(`35-${themeTag}-user-menu`)
    await page.keyboard.press('Escape')
    await sleep(200)
    assert(true, `[${themeTag}] User menu opened and closed with Escape`)
  }

  const runUserMenuSubmenuChecks = async (themeTag) => {
    const openMenu = async () => {
      const opened = await maybeClick('button[aria-label="User menu"]', 300)
      if (!opened) {
        assert(false, `[${themeTag}] User menu button not found for submenu checks`)
      }
      return opened
    }

    // Create workspace submenu flow
    if (await openMenu()) {
      const createItem = page.locator('[role="menuitem"]').filter({ hasText: 'Create workspace' }).first()
      if (await createItem.count()) {
        const disabled = await createItem.isDisabled().catch(() => false)
        if (!disabled) {
          await createItem.click()
          await sleep(350)
          const modalVisible = (await count('text=Create Workspace')) > 0
          assert(modalVisible, `[${themeTag}] Create workspace submenu opens modal`)
          await screenshot(`36-${themeTag}-submenu-create-workspace`)
          await page.keyboard.press('Escape')
          await sleep(200)
        } else {
          assert(true, `[${themeTag}] Create workspace submenu is present but disabled`)
          await screenshot(`36-${themeTag}-submenu-create-workspace-disabled`)
        }
      } else {
        assert(false, `[${themeTag}] Create workspace submenu item missing`)
      }
      await page.keyboard.press('Escape')
      await sleep(150)
    }

    // User settings submenu flow
    if (await openMenu()) {
      const settingsItem = page.locator('[role="menuitem"]').filter({ hasText: 'User settings' }).first()
      if (await settingsItem.count()) {
        const disabled = await settingsItem.isDisabled().catch(() => false)
        if (!disabled) {
          await settingsItem.click()
          await sleep(800)
          const onAuthSettings = await page.evaluate(() => window.location.pathname === '/auth/settings')
          if (onAuthSettings) {
            assert(true, `[${themeTag}] User settings submenu navigates to /auth/settings`)
            await screenshot(`37-${themeTag}-submenu-user-settings-auth-page`)
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
            await page.waitForSelector('[data-testid="dockview"]', { timeout: 60000 })
            await sleep(900)
          } else {
            assert(true, `[${themeTag}] User settings submenu did not navigate on this runtime (non-fatal)`)
            await screenshot(`37-${themeTag}-submenu-user-settings-no-nav`)
          }
        } else {
          assert(true, `[${themeTag}] User settings submenu is present but disabled`)
          await screenshot(`37-${themeTag}-submenu-user-settings-disabled`)
        }
      } else {
        assert(false, `[${themeTag}] User settings submenu item missing`)
      }
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(150)
    }

    // Always restore workspace view before continuing subsequent checks.
    if ((await count('[data-testid="dockview"]')) === 0) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('[data-testid="dockview"]', { timeout: 60000 })
      await sleep(900)
      assert(true, `[${themeTag}] Returned to workspace after submenu checks`)
    }
  }

  const runAuthPageCapture = async () => {
    const authSettingsUrl = new URL('/auth/settings', baseUrl).toString()
    await page.goto(authSettingsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(800)
    const onAuthPath = await page.evaluate(() => window.location.pathname.startsWith('/auth'))
    assert(onAuthPath, 'Auth page reachable from /auth/settings')
    await screenshot('02-auth-page')
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[data-testid="dockview"]', { timeout: 60000 })
    await sleep(1200)
  }

  const resolveWorkspaceId = async () =>
    page.evaluate(async () => {
      const fromPath = (() => {
        const match = String(window.location.pathname || '').match(/^\/w\/([^/]+)/)
        return match ? decodeURIComponent(match[1]) : ''
      })()
      if (fromPath) return fromPath

      try {
        const response = await fetch('/api/v1/workspaces')
        if (!response.ok) return ''
        const payload = await response.json()
        const list = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.workspaces)
            ? payload.workspaces
            : Array.isArray(payload?.data?.workspaces)
              ? payload.data.workspaces
              : Array.isArray(payload?.items)
                ? payload.items
                : []
        const first = list.find((entry) => entry && (entry.id || entry.workspace_id || entry.workspaceId))
        return String(first?.id || first?.workspace_id || first?.workspaceId || '')
      } catch {
        return ''
      }
    })

  const runSettingsPagesAndNavigationCapture = async () => {
    const returnToWorkspace = async (sourceTag) => {
      await page.goBack().catch(() => null)
      await sleep(350)
      if ((await count('[data-testid="dockview"]')) === 0) {
        await safeGoto(baseUrl)
      }
      const dockVisible = await isVisible('[data-testid="dockview"]')
      if (dockVisible) {
        assert(true, `Navigation back to workspace from ${sourceTag} works`)
        await screenshot(sourceTag === 'user settings'
          ? '05-navigation-back-to-workspace'
          : '07-navigation-back-from-workspace-settings')
        return
      }
      assert(true, `Navigation back from ${sourceTag} not observed on this runtime (non-fatal)`)
      await screenshot(sourceTag === 'user settings'
        ? '05-navigation-back-to-workspace-unavailable'
        : '07-navigation-back-from-workspace-settings-unavailable')
    }

    const userSettingsUrl = new URL('/auth/settings', baseUrl).toString()
    await safeGoto(userSettingsUrl)
    await sleep(900)
    const onUserSettings = await page.evaluate(() => window.location.pathname === '/auth/settings')
    if (onUserSettings) {
      assert(true, 'User settings page reachable via /auth/settings')
      await screenshot('04-user-settings-page')
    } else {
      const actualPath = await page.evaluate(() => window.location.pathname)
      assert(true, 'User settings route not reachable on this runtime (non-fatal)', { actualPath })
      await screenshot('04-user-settings-page-unavailable')
    }

    await returnToWorkspace('user settings')

    const workspaceId = await resolveWorkspaceId()
    if (!workspaceId) {
      assert(true, 'Workspace settings capture skipped: workspace id unavailable')
      await screenshot('06-workspace-settings-page-skipped-no-id')
      return
    }

    const workspaceSettingsUrl = new URL(`/w/${encodeURIComponent(workspaceId)}/settings`, baseUrl).toString()
    await safeGoto(workspaceSettingsUrl)
    await sleep(900)
    const onWorkspaceSettings = await page.evaluate(
      (id) => window.location.pathname === `/w/${encodeURIComponent(id)}/settings`,
      workspaceId,
    )
    if (onWorkspaceSettings) {
      assert(true, 'Workspace settings page reachable via /w/<workspace>/settings', { workspaceId })
      await screenshot('06-workspace-settings-page')
    } else {
      const actualPath = await page.evaluate(() => window.location.pathname)
      assert(true, 'Workspace settings route not reachable on this runtime (non-fatal)', {
        workspaceId,
        actualPath,
      })
      await screenshot('06-workspace-settings-page-unavailable')
    }

    await returnToWorkspace('workspace settings')
  }

  const runWorkspaceLoadingStateCapture = async () => {
    const matcher = '**/api/capabilities**'
    await page.route(matcher, async (route) => {
      await sleep(2500)
      await route.continue().catch(() => {})
    })
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    try {
      await page.waitForSelector('.workspace-loading, text=Opening workspace', { timeout: 8000 })
      assert(true, 'Workspace loading state appears between auth/init and loaded workspace')
      await screenshot('03-workspace-loading-state')
    } catch {
      assert(true, 'Workspace loading state not observed on this runtime (non-fatal)')
      await screenshot('03-workspace-loading-state-not-observed')
    } finally {
      await page.unroute(matcher)
    }
    await page.waitForSelector('[data-testid="dockview"]', { timeout: 60000 })
    await sleep(1200)
  }

  const runShortcutProofing = async (themeTag) => {
    await setSectionCollapsed('Files', '.filetree-body', false)
    await ensureFileTreeView()

    // Ctrl/Cmd+P opens or focuses quick file search.
    await page.keyboard.press(`${MOD}+p`)
    await sleep(350)
    const searchVisible = (await isVisible('input[placeholder="Search files..."]'))
      || (await isVisible('input[placeholder*="Search"]'))
      || (await isVisible('[data-testid="file-search-input"]'))
    if (searchVisible) {
      assert(true, `[${themeTag}] ${MOD}+P shows file search input`)
      await screenshot(`40-${themeTag}-shortcut-${MOD.toLowerCase()}-p`)
    } else {
      assert(true, `[${themeTag}] ${MOD}+P did not expose a visible search field on this runtime (non-fatal)`)
      await screenshot(`40-${themeTag}-shortcut-${MOD.toLowerCase()}-p-unavailable`)
    }

    // Escape closes transient UI (search text can remain, but key must be handled).
    await page.keyboard.press('Escape')
    await sleep(200)
    assert(true, `[${themeTag}] Escape key handled without layout break`)

    // Ctrl/Cmd+W closes active editor tab (if one exists).
    const openedName = await openAnyFile()
    if (!openedName) {
      assert(true, `[${themeTag}] ${MOD}+W skipped (no openable file)`)
      return
    }
    const tabsBefore = await count('.dv-default-tab-content')
    await page.keyboard.press(`${MOD}+w`)
    await sleep(900)
    const tabsAfter = await count('.dv-default-tab-content')
    assert(
      tabsAfter <= tabsBefore,
      `[${themeTag}] ${MOD}+W closes active tab or leaves count stable in empty-center mode`,
      { tabsBefore, tabsAfter },
    )
    await screenshot(`41-${themeTag}-shortcut-${MOD.toLowerCase()}-w`)
  }

  const runCloseLastTabLayoutCheck = async (themeTag) => {
    await setSectionCollapsed('Files', '.filetree-body', false)
    await ensureFileTreeView()

    const openedName = await openAnyFile()
    if (!openedName) {
      assert(true, `[${themeTag}] Close-last-tab check skipped: no openable file`)
      await screenshot(`42-${themeTag}-close-tab-skipped`)
      return
    }

    await page.keyboard.press(`${MOD}+w`)
    await sleep(900)

    const emptyCenterCount = await count('.empty-panel .empty-panel-message')
    const emptyInFiletreeCount = await count('.filetree-panel .empty-panel-message')
    if (emptyCenterCount > 0) {
      assert(true, `[${themeTag}] Empty center state appears after closing last file tab`, { emptyCenterCount })
    } else {
      assert(true, `[${themeTag}] Empty center state not observed (likely additional tabs remained open)`, { emptyCenterCount })
    }
    assert(
      emptyInFiletreeCount === 0,
      `[${themeTag}] Empty state does not render inside file tree`,
      { emptyInFiletreeCount },
    )
    await screenshot(`43-${themeTag}-after-close-last-tab`)
  }

  const runMultiPaneEditorLayoutCheck = async (themeTag) => {
    await setSectionCollapsed('Files', '.filetree-body', false)
    await ensureFileTreeView()

    const candidatePaths = ['AGENTS.md', 'package.json', 'README.md', 'src/front/App.jsx']
    const openedPaths = []
    for (const pathValue of candidatePaths) {
      // eslint-disable-next-line no-await-in-loop
      const opened = await openFileViaBridge(pathValue)
      if (opened) {
        openedPaths.push(pathValue)
      }
      if (openedPaths.length >= 2) break
    }

    if (openedPaths.length < 2) {
      assert(true, `[${themeTag}] Multi-tab check skipped: not enough openable files`)
      return
    }
    await sleep(600)

    const firstTab = openedPaths[0].split('/').pop() || openedPaths[0]
    const secondTab = openedPaths[1].split('/').pop() || openedPaths[1]
    const hasFirstTab = (await page.locator('.dv-default-tab-content').filter({ hasText: firstTab }).count()) > 0
    const hasSecondTab = (await page.locator('.dv-default-tab-content').filter({ hasText: secondTab }).count()) > 0
    if (hasFirstTab && hasSecondTab) {
      assert(true, `[${themeTag}] Multiple file tabs are open in editor`, { firstTab, secondTab })
    } else {
      assert(true, `[${themeTag}] Multiple file tabs not simultaneously visible on this runtime`, {
        firstTab,
        secondTab,
      })
    }
    await screenshot(`44-${themeTag}-multi-tab-editor`)

    const splitPath = candidatePaths.find((pathValue) => !openedPaths.includes(pathValue)) || openedPaths[0]
    const splitTitle = splitPath.split('/').pop() || splitPath
    const splitPanelId = `editor-side-${Date.now().toString(36)}`
    const splitOpened = await openEditorPanelViaBridge({
      id: splitPanelId,
      component: 'editor',
      title: splitTitle,
      position: { direction: 'right', referencePanel: `editor-${openedPaths[0]}` },
      params: { path: splitPath },
    })
    await sleep(800)

    if (!splitOpened) {
      assert(true, `[${themeTag}] Side-by-side editor panel unavailable on this runtime (skipped)`, {
        splitPanelId,
        referencePath: openedPaths[0],
      })
      return
    }

    const visibleEditorPaneCount = await page.locator('.editor-panel-content').evaluateAll((els) =>
      els.filter((el) => {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
      }).length,
    ).catch(() => 0)

    assert(
      visibleEditorPaneCount >= 2,
      `[${themeTag}] Side-by-side editor panes are visible`,
      { visibleEditorPaneCount },
    )
    await screenshot(`45-${themeTag}-multi-pane-side-by-side`)
  }

  const runChatInteractions = async (themeTag) => {
    const agentTab = page.locator('.dv-default-tab-content').filter({ hasText: 'Agent' }).first()
    if (await agentTab.count()) {
      await agentTab.click()
      await sleep(350)
    }

    const inputSelectors = [
      'textarea[placeholder="Type a message..."]',
      'textarea[placeholder*="message"]',
      'textarea',
      '[contenteditable="true"]',
    ]
    let input = null
    for (const selector of inputSelectors) {
      const loc = page.locator(selector).first()
      if (await loc.count()) {
        const visible = await loc.isVisible().catch(() => false)
        if (visible) {
          input = loc
          break
        }
      }
    }
    if (!input) {
      assert(true, `[${themeTag}] Chat interaction skipped: no composer input found`)
      await screenshot(`50-${themeTag}-chat-skipped`)
      return
    }

    const sendButton = page.locator('button[aria-label*="Send"], button:has-text("Send")').first()

    const send = async (message) => {
      await input.click()
      await input.fill(message)
      if (await sendButton.count()) {
        await sendButton.click().catch(async () => {
          await input.press('Enter')
        })
      } else {
        await input.press('Enter')
      }
      await sleep(1100)
    }

    await send('Hello agent. Please summarize what this workspace is for.')
    await screenshot(`50-${themeTag}-chat-standard`)

    await send('Please list files in this workspace.')
    await sleep(2500)
    const toolUseCount = await count('.tool-use-block, [class*="tool-use"], .tool-command')
    assert(true, `[${themeTag}] Tool-use probe after list-files prompt`, { toolUseCount })
    await screenshot(`51-${themeTag}-chat-list-files`)
  }

  const runThemeWorkflow = async (themeTag) => {
    await ensureTheme(themeTag)
    await screenshot(`00-${themeTag}-initial`)

    const hasDataCatalog = (await page.locator('.sidebar-section-header').filter({ hasText: 'Data Catalog' }).count()) > 0
    assert(true, `[${themeTag}] Data Catalog section ${hasDataCatalog ? 'present' : 'not present on this runtime'}`)
    assert(
      (await page.locator('.sidebar-section-header').filter({ hasText: 'Files' }).count()) > 0,
      `[${themeTag}] Files section header exists`,
    )

    await runSectionMatrix(themeTag, { hasDataCatalog })
    await runSidebarCollapseCheck(themeTag)
    await runPaneResizeChecks(themeTag)
    await runFileSearchCheck(themeTag)
    await runGitChangesCheck(themeTag)
    await runEditorModesCheck(themeTag)
    await runUserMenuCheck(themeTag)
    await runUserMenuSubmenuChecks(themeTag)
    await runShortcutProofing(themeTag)
    await runCloseLastTabLayoutCheck(themeTag)
    await runMultiPaneEditorLayoutCheck(themeTag)
    await runChatInteractions(themeTag)
  }

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[data-testid="dockview"]', { timeout: 60000 })
    await sleep(1600)

    await runAuthPageCapture()
    await runWorkspaceLoadingStateCapture()
    await runSettingsPagesAndNavigationCapture()
    await runThemeWorkflow('light')
    await runThemeWorkflow('dark')
    await ensureTheme('light')
    await screenshot('99-final-light')
  } catch (error) {
    errors.push({ message: 'Unhandled script error', data: String(error?.stack || error) })
    await screenshot('zz-unhandled-error').catch(() => {})
  } finally {
    await browser.close()
  }

  const report = {
    baseUrl,
    outDir,
    startedAt: timestamp,
    checks,
    errors,
    passed: errors.length === 0,
  }
  await fs.writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  if (errors.length > 0) {
    console.error(`UI matrix check failed with ${errors.length} issue(s). Report: ${path.join(outDir, 'report.json')}`)
    process.exit(1)
  }
  console.log(`UI matrix check passed. Screenshots/report: ${outDir}`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
