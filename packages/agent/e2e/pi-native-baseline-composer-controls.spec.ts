import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

const MODEL_LABEL_ORDER = ['Claude Sonnet', 'Claude Opus', 'GPT Main', 'GPT Fast'] as const

test.describe('Pi-native baseline composer controls', () => {
  test('keeps the workspace-style composer rail and slash settings baseline', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer"]')
    const rail = page.locator('[data-boring-agent-part="composer-rail"]')
    const inputGroup = composer.locator('[data-slot="input-group"]')
    const settingsRow = page.locator('[data-boring-agent-part="composer-settings-row"]')
    const modelSelect = page.locator('[data-boring-agent-part="model-select"]')
    const thinkingSelect = page.locator('[data-boring-agent-part="thinking-select"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(modelSelect).toContainText('/model:', { timeout: 10_000 })
    await expect(thinkingSelect).toContainText('/thinking:')
    await expect(page.getByRole('option', { name: /Claude Sonnet/ })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /Deep reasoning/ })).toHaveCount(0)

    const chrome = await readComposerChrome(page)
    await expect(rail).toBeVisible()
    await expect(inputGroup).toBeVisible()
    expect(Math.round(chrome.rail.height)).toBe(56)
    expect(chrome.rail.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(chrome.rail.boxShadow).toContain('inset')
    expect(chrome.rail.borderWidth).toBe('0px')
    expect(chrome.rail.borderRadius).toBeGreaterThan(20)
    expect(Math.round(chrome.inputGroup.height)).toBe(56)
    // The composer input-group is a column shell (textarea row stacked over the
    // controls row); the visible horizontal bar is the inner items-center row.
    expect(chrome.inputGroup.flexDirection).toBe('column')
    expect(chrome.inputGroup.alignItems).toBe('stretch')
    expect(chrome.inputGroup.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(chrome.inputGroup.boxShadow).not.toContain('inset')
    expect(chrome.inputGroup.borderWidth).toBe('0px')
    expect(chrome.inputGroup.borderRadius).toBeGreaterThan(20)
    expect(chrome.formClass).not.toContain('!bg-[color:var(--background)]')
    expect(chrome.formClass).not.toContain('shadow-[inset')
    expect(chrome.viewport.height - chrome.chat.bottom).toBeLessThanOrEqual(1)
    if (chrome.viewport.width >= 768) {
      expect(Math.abs(chrome.chat.width - chrome.viewport.width)).toBeLessThanOrEqual(1)
    }
    expect(chrome.footerControlsBelowComposer).toBe(false)
    expect(chrome.submit.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(chrome.submit.status).toBe('ready')
    expect(chrome.submit.className).toContain('!text-background')
    expect(Math.round(chrome.settings.top - chrome.rail.bottom)).toBe(6)
    expect(Math.round(chrome.settings.width)).toBe(Math.round(chrome.rail.width))
    expect(chrome.settings.justifyContent).toBe('center')
    expect(chrome.settings.gap).toBe('6px')
    expect(chrome.settings.fontSize).toBe('10.5px')
    expect(chrome.settings.color).toContain('/ 0.45')
    expect(chrome.modelSelect.borderRadius).toBeGreaterThan(0)
    expect(Math.round(chrome.modelSelect.height)).toBe(20)
    expect(chrome.thinkingSelect.borderRadius).toBeGreaterThan(0)
    expect(Math.round(chrome.thinkingSelect.height)).toBe(20)

    await testInfo.attach('pi-native-baseline-composer-rail.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T0-composer-rail',
        chrome,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('grows the composer vertically when Shift+Enter adds lines inside the draft', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    const singleLine = await readComposerChrome(page)
    await composer.fill('first row draft')
    await expect(composer).toHaveValue('first row draft')
    const firstRowDraft = await readComposerChrome(page)
    expect(Math.round(firstRowDraft.rail.height)).toBe(Math.round(singleLine.rail.height))
    expect(Math.round(firstRowDraft.inputGroup.height)).toBe(Math.round(singleLine.inputGroup.height))
    expect(Math.round(firstRowDraft.textarea.height)).toBe(Math.round(singleLine.textarea.height))
    expect(firstRowDraft.rail.multiline).toBe('false')
    expect(firstRowDraft.textarea.className).toContain('[field-sizing:fixed]')
    expect(firstRowDraft.textarea.fieldSizing).toBe('fixed')

    await composer.fill('')
    await composer.click()
    await page.keyboard.type('typed first row')
    await expect(composer).toHaveValue('typed first row')
    const typedFirstRowDraft = await readComposerChrome(page)
    expect(Math.round(typedFirstRowDraft.rail.height)).toBe(Math.round(singleLine.rail.height))
    expect(Math.round(typedFirstRowDraft.inputGroup.height)).toBe(Math.round(singleLine.inputGroup.height))
    expect(Math.round(typedFirstRowDraft.textarea.height)).toBe(Math.round(singleLine.textarea.height))
    expect(typedFirstRowDraft.rail.multiline).toBe('false')
    expect(typedFirstRowDraft.textarea.fieldSizing).toBe('fixed')

    await composer.fill('first line')
    await composer.press('Shift+Enter')
    await composer.type('second line')
    await composer.press('Shift+Enter')
    await composer.type('third line')

    await expect(composer).toHaveValue('first line\nsecond line\nthird line')
    await expect.poll(async () => {
      const chrome = await readComposerChrome(page)
      return Math.round(chrome.rail.height)
    }).toBeGreaterThan(Math.round(singleLine.rail.height))

    const multiLine = await readComposerChrome(page)
    expect(multiLine.inputGroup.height).toBeGreaterThan(singleLine.inputGroup.height)
    expect(Math.round(multiLine.rail.height - singleLine.rail.height)).toBeGreaterThanOrEqual(32)
    expect(multiLine.rail.multiline).toBe('true')
    expect(multiLine.rail.cssHeight).toBe(`${Math.round(multiLine.inputGroup.height)}px`)
    expect(multiLine.inputGroup.alignItems).toBe('stretch')
    expect(multiLine.textarea.value).toBe('first line\nsecond line\nthird line')
    expect(multiLine.textarea.height).toBeGreaterThan(singleLine.textarea.height)
    expect(multiLine.textarea.clientHeight + 1).toBeGreaterThanOrEqual(multiLine.textarea.scrollHeight)
    expect(multiLine.textarea.overflowY).toBe('hidden')
    expect(multiLine.textarea.flexGrow).toBe('1')
    expect(multiLine.textarea.flexShrink).toBe('1')
    expect(multiLine.textarea.minWidth).toBe('0px')
    expect(multiLine.textarea.className).not.toContain('!h-10')
    expect(multiLine.textarea.className).not.toContain('!max-h-10')
    expect(multiLine.textarea.className).not.toContain('!h-auto')

    await testInfo.attach('pi-native-baseline-composer-multiline-growth.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T0-composer-multiline-growth',
        singleLine,
        firstRowDraft,
        typedFirstRowDraft,
        multiLine,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('grows the composer vertically when a draft soft-wraps without explicit newlines', async ({ page, backend }, testInfo) => {
    await page.setViewportSize({ width: 960, height: 760 })
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    const singleLine = await readComposerChrome(page)
    const softWrappedDraft = 'soft wrap draft text '.repeat(8).trim()
    await composer.fill(softWrappedDraft)
    await expect(composer).toHaveValue(softWrappedDraft)

    await expect.poll(async () => {
      const chrome = await readComposerChrome(page)
      return Math.round(chrome.rail.height)
    }).toBeGreaterThan(Math.round(singleLine.rail.height))

    const wrapped = await readComposerChrome(page)
    expect(wrapped.textarea.value).not.toContain('\n')
    expect(wrapped.rail.multiline).toBe('true')
    expect(wrapped.inputGroup.height).toBeGreaterThan(singleLine.inputGroup.height)
    expect(wrapped.textarea.scrollHeight).toBeGreaterThan(singleLine.textarea.scrollHeight)
    expect(wrapped.textarea.scrollHeight).toBeLessThanOrEqual(160)
    expect(wrapped.textarea.clientHeight + 1).toBeGreaterThanOrEqual(wrapped.textarea.scrollHeight)
    expect(wrapped.textarea.overflowY).toBe('hidden')

    await testInfo.attach('pi-native-baseline-composer-soft-wrap-growth.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T0-composer-soft-wrap-growth',
        singleLine,
        wrapped,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('keeps model order and thinking state stable without mutating chat history', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const modelSelect = page.locator('[data-boring-agent-part="model-select"]')
    const thinkingSelect = page.locator('[data-boring-agent-part="thinking-select"]')
    const messages = page.locator('[data-boring-agent-part="message"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(modelSelect).toContainText('Claude Sonnet', { timeout: 10_000 })
    await expect(messages).toHaveCount(0)

    await modelSelect.click()
    expect(await readModelLabels(page)).toEqual([...MODEL_LABEL_ORDER])

    await page.getByText('Claude Opus').click()
    await expect(modelSelect).toContainText('Claude Opus')
    await expect(messages).toHaveCount(0)

    await modelSelect.click()
    expect(await readModelLabels(page)).toEqual([...MODEL_LABEL_ORDER])
    await page.keyboard.press('Escape')

    await thinkingSelect.click()
    await page.getByRole('option', { name: 'Med' }).click()
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: Med')

    await expect(messages).toHaveCount(0)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', /connected|connecting/, { timeout: 10_000 })
    await expect(modelSelect).toContainText('Claude Opus', { timeout: 10_000 })
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: Med')
    await expect(messages).toHaveCount(0)

    await testInfo.attach('pi-native-baseline-composer-controls.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T1',
        modelLabels: await openAndReadModelLabels(page),
        selectedModel: await modelSelect.textContent(),
        thinkingLabel: await thinkingSelect.getAttribute('aria-label'),
        messageCount: await messages.count(),
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('opens model and thinking menus in the slash picker slot with keyboard-safe composer history', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 2,
        status: 'idle',
        messages: [
          { id: 'composer-history-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'composer-history-u1:text', text: 'prior composer history prompt' }] },
          { id: 'composer-history-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'composer-history-a1:text', text: 'PRIOR_HISTORY_DONE' }] },
        ],
        queue: { followUps: [] },
        prompts: [],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
      }))
    })
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    const modelSelect = page.locator('[data-boring-agent-part="model-select"]')
    const thinkingSelect = page.locator('[data-boring-agent-part="thinking-select"]')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(page.getByLabel('Agent conversation').getByText('PRIOR_HISTORY_DONE')).toBeVisible({ timeout: 10_000 })

    await composer.fill('/')
    const slashMenu = page.getByRole('listbox', { name: 'Commands' })
    await expect(slashMenu).toBeVisible()
    const slashRect = await readPickerRect(slashMenu.locator('..'))

    await composer.fill('/mod')
    await slashMenu.getByText('/model').click()
    const modelMenu = page.locator('[data-boring-agent-part="model-picker-menu"]')
    await expect(modelMenu).toBeVisible()
    const modelRect = await readPickerRect(modelMenu)
    expect(modelRect.left).toBe(slashRect.left)
    expect(modelRect.width).toBe(slashRect.width)
    expect(modelRect.bottom).toBe(slashRect.bottom)
    expect(await isInsidePopover(page, '[data-boring-agent-part="model-picker-menu"]')).toBe(false)

    await composer.press('ArrowUp')
    await expect(modelMenu).toBeVisible()
    await expect(composer).toHaveValue('')
    await composer.press('Escape')
    await expect(modelMenu).toHaveCount(0)

    await composer.fill('/mod')
    await slashMenu.getByText('/model').click()
    await expect(modelMenu).toBeVisible()
    await composer.press('ArrowDown')
    await composer.press('Enter')
    await expect(modelMenu).toHaveCount(0)
    await expect(modelSelect).toContainText('Claude Opus')

    await composer.fill('/thinking')
    await slashMenu.getByText('/thinking', { exact: true }).click()
    const thinkingMenu = page.locator('[data-boring-agent-part="thinking-picker-menu"]')
    await expect(thinkingMenu).toBeVisible()
    const thinkingRect = await readPickerRect(thinkingMenu)
    expect(thinkingRect.left).toBe(slashRect.left)
    expect(thinkingRect.width).toBe(slashRect.width)
    expect(thinkingRect.bottom).toBe(slashRect.bottom)
    expect(await isInsidePopover(page, '[data-boring-agent-part="thinking-picker-menu"]')).toBe(false)

    await composer.press('Escape')
    await expect(thinkingMenu).toHaveCount(0)
    await composer.fill('/thinking')
    await slashMenu.getByText('/thinking', { exact: true }).click()
    await expect(thinkingMenu).toBeVisible()
    await composer.press('ArrowDown')
    await composer.press('Enter')
    await expect(thinkingMenu).toHaveCount(0)
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: High')

    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await modelSelect.click()
    await expect(modelMenu).toBeVisible()
    const darkSurface = await readPickerSurface(page, '[data-boring-agent-part="model-picker-menu"]')
    expect(darkSurface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(darkSurface.backgroundColor).not.toBe('transparent')
    expect(darkSurface.color).not.toBe('rgba(0, 0, 0, 0)')
    expect(darkSurface.color).not.toBe('transparent')
    expect(darkSurface.boxShadow).toBe(true)

    await testInfo.attach('pi-native-baseline-inline-settings-picker.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T1-inline-settings-picker',
        slashRect,
        modelRect,
        thinkingRect,
        darkSurface,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('sends selected model and thinking metadata with the next idle prompt', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const modelSelect = page.locator('[data-boring-agent-part="model-select"]')
    const thinkingSelect = page.locator('[data-boring-agent-part="thinking-select"]')
    const composer = page.locator('[data-boring-agent-part="composer-input"]')
    const conversation = page.getByLabel('Agent conversation')

    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })

    await modelSelect.click()
    await page.getByText('Claude Opus').click()
    await thinkingSelect.click()
    await page.getByRole('option', { name: 'Med' }).click()

    await composer.fill('baseline model metadata prompt')
    await page.locator('[data-boring-agent-part="composer-submit"]').click()

    await expect(conversation.getByText('PI_NATIVE_ASSISTANT_DONE')).toBeVisible({ timeout: 10_000 })
    const state = await readMockState(page)
    expect(state.prompts).toHaveLength(1)
    expect(state.prompts[0]).toMatchObject({
      message: '<redacted>',
      model: { provider: 'anthropic', id: 'claude-opus' },
      thinkingLevel: 'medium',
    })
    expect(JSON.stringify(state.prompts)).not.toContain('baseline model metadata prompt')

    await testInfo.attach('pi-native-baseline-composer-prompt-metadata.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T1-prompt-metadata',
        prompts: state.prompts,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('freezes model and thinking controls while streaming and re-enables them after session switch', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      localStorage.setItem('boring-agent:v2:agent-playground:activeSessionId', 'pi-e2e')
      localStorage.setItem('boring-agent:v2:agent-playground:composer:model', JSON.stringify({ provider: 'anthropic', id: 'claude-opus' }))
      localStorage.setItem('boring-agent:v2:agent-playground:composer:model:user-selected', '1')
      localStorage.setItem('boring-agent:v2:agent-playground:composer:thinking', 'medium')
      localStorage.setItem('__boring_pi_native_e2e_state__', JSON.stringify({
        seq: 0,
        status: 'idle',
        messages: [],
        queue: { followUps: [] },
        prompts: [],
        followups: [],
        stops: 0,
        interrupts: 0,
        clears: 0,
        reloads: 0,
        uiCommandDispatches: 0,
        sessions: [
          { id: 'pi-e2e', title: 'Streaming controls session', createdAt: '2026-06-04T00:00:00.000Z', updatedAt: '2026-06-04T00:05:00.000Z', turnCount: 2 },
          { id: 'controls-idle', title: 'Idle controls session', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:05:00.000Z', turnCount: 2 },
        ],
        sessionStates: {
          'pi-e2e': {
            seq: 4,
            status: 'streaming',
            messages: [
              { id: 'controls-active-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'controls-active-u1:text', text: '<redacted active prompt>' }] },
              { id: 'controls-active-a1', role: 'assistant', status: 'streaming', parts: [{ type: 'text', id: 'controls-active-a1:text', text: 'ACTIVE_CONTROL_STREAM' }] },
            ],
            queue: { followUps: [] },
            prompts: [],
            followups: [],
            stops: 0,
            interrupts: 0,
            clears: 0,
            reloads: 0,
            uiCommandDispatches: 0,
          },
          'controls-idle': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'controls-idle-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'controls-idle-u1:text', text: '<redacted idle prompt>' }] },
              { id: 'controls-idle-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'controls-idle-a1:text', text: 'IDLE_CONTROL_SESSION' }] },
            ],
            queue: { followUps: [] },
            prompts: [],
            followups: [],
            stops: 0,
            interrupts: 0,
            clears: 0,
            reloads: 0,
            uiCommandDispatches: 0,
          },
        },
      }))
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    const chat = page.locator('[data-boring-agent-part="chat"]')
    const conversation = page.getByLabel('Agent conversation')
    const rows = page.locator('[data-boring-agent-part="session-row"]')
    const modelSelect = page.locator('[data-boring-agent-part="model-select"]')
    const thinkingSelect = page.locator('[data-boring-agent-part="thinking-select"]')
    const messages = page.locator('[data-boring-agent-part="message"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e', { timeout: 10_000 })
    await expect(conversation.getByText('ACTIVE_CONTROL_STREAM')).toBeVisible({ timeout: 10_000 })
    await expect(modelSelect).toContainText('Claude Opus', { timeout: 10_000 })
    await expect(modelSelect).toBeDisabled()
    await expect(modelSelect).toHaveAttribute('data-boring-state', 'disabled')
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: Med')
    await expect(thinkingSelect).toBeDisabled()
    await expect(thinkingSelect).toHaveAttribute('data-boring-state', 'disabled')
    const activeMessageIds = await readMessageIds(page)

    await rows.filter({ hasText: 'Idle controls session' }).click()

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'controls-idle', { timeout: 10_000 })
    await expect(conversation.getByText('IDLE_CONTROL_SESSION')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('ACTIVE_CONTROL_STREAM')).toHaveCount(0)
    await expect(modelSelect).toContainText('Claude Opus')
    await expect(modelSelect).not.toBeDisabled()
    await expect(modelSelect).not.toHaveAttribute('data-boring-state', 'disabled')
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: Med')
    await expect(thinkingSelect).not.toBeDisabled()
    await expect(thinkingSelect).not.toHaveAttribute('data-boring-state', 'disabled')
    await expect(messages).toHaveCount(2)

    await rows.filter({ hasText: 'Streaming controls session' }).click()

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'pi-e2e', { timeout: 10_000 })
    await expect(conversation.getByText('ACTIVE_CONTROL_STREAM')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('IDLE_CONTROL_SESSION')).toHaveCount(0)
    await expect(modelSelect).toContainText('Claude Opus')
    await expect(modelSelect).toBeDisabled()
    await expect(modelSelect).toHaveAttribute('data-boring-state', 'disabled')
    await expect(thinkingSelect).toHaveAttribute('aria-label', 'Thinking level: Med')
    await expect(thinkingSelect).toBeDisabled()
    await expect(thinkingSelect).toHaveAttribute('data-boring-state', 'disabled')

    await testInfo.attach('pi-native-baseline-composer-active-switch.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T1-active-switch',
        activeMessageIds,
        streamingMessageIdsAfterReturn: await readMessageIds(page),
        selectedModel: await modelSelect.textContent(),
        thinkingLabel: await thinkingSelect.getAttribute('aria-label'),
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})

async function openAndReadModelLabels(page: Page): Promise<string[]> {
  await page.locator('[data-boring-agent-part="model-select"]').click()
  return readModelLabels(page)
}

async function readModelLabels(page: Page): Promise<string[]> {
  const items = page.locator('[cmdk-item]')
  await expect(items.first()).toBeVisible({ timeout: 10_000 })
  const itemTexts = await items.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  )
  return itemTexts
    .map((text) => MODEL_LABEL_ORDER.find((label) => text.includes(label)) ?? null)
    .filter((label): label is typeof MODEL_LABEL_ORDER[number] => label !== null)
}

async function readPickerRect(locator: Locator): Promise<{
  left: number
  bottom: number
  width: number
}> {
  const rect = await locator.evaluate((node) => {
    const box = (node as HTMLElement).getBoundingClientRect()
    return {
      left: Math.round(box.left * 100) / 100,
      bottom: Math.round(box.bottom * 100) / 100,
      width: Math.round(box.width * 100) / 100,
    }
  })
  return rect
}

async function isInsidePopover(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((node) => Boolean(node.closest('[data-slot="popover-content"]')))
}

async function readPickerSurface(page: Page, selector: string): Promise<{
  backgroundColor: string
  color: string
  boxShadow: boolean
}> {
  return page.locator(selector).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      boxShadow: style.boxShadow !== 'none',
    }
  })
}

async function readComposerChrome(page: Page): Promise<{
  formClass: string
  viewport: {
    width: number
    height: number
  }
  chat: {
    width: number
    bottom: number
  }
  rail: {
    width: number
    height: number
    bottom: number
    multiline: string | null
    cssHeight: string
    backgroundColor: string
    boxShadow: string
    borderRadius: number
    borderWidth: string
  }
  inputGroup: {
    height: number
    backgroundColor: string
    boxShadow: string
    borderRadius: number
    borderWidth: string
    flexDirection: string
    alignItems: string
  }
  textarea: {
    width: number
    height: number
    clientHeight: number
    scrollHeight: number
    value: string
    overflowY: string
    flexGrow: string
    flexShrink: string
    minWidth: string
    fieldSizing: string | null
    className: string
  }
  submit: {
    backgroundColor: string
    color: string
    className: string
    status: string | null
  }
  settings: {
    width: number
    top: number
    justifyContent: string
    gap: string
    fontSize: string
    color: string
  }
  modelSelect: {
    height: number
    borderRadius: number
  }
  thinkingSelect: {
    height: number
    borderRadius: number
  }
  footerControlsBelowComposer: boolean
}> {
  return page.evaluate(() => {
    const chat = document.querySelector<HTMLElement>('[data-boring-agent-part="chat"]')
    const form = document.querySelector<HTMLElement>('[data-boring-agent-part="composer"]')
    const rail = document.querySelector<HTMLElement>('[data-boring-agent-part="composer-rail"]')
    const inputGroup = document.querySelector<HTMLElement>('[data-boring-agent-part="composer"] [data-slot="input-group"]')
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-boring-agent-part="composer-input"]')
    const submit = document.querySelector<HTMLElement>('[data-boring-agent-part="composer-submit"]')
    const settings = document.querySelector<HTMLElement>('[data-boring-agent-part="composer-settings-row"]')
    const modelSelect = document.querySelector<HTMLElement>('[data-boring-agent-part="model-select"]')
    const thinkingSelect = document.querySelector<HTMLElement>('[data-boring-agent-part="thinking-select"]')
    if (!chat || !form || !rail || !inputGroup || !textarea || !submit || !settings || !modelSelect || !thinkingSelect) throw new Error('Composer chrome is missing')

    const chatRect = chat.getBoundingClientRect()
    const railRect = rail.getBoundingClientRect()
    const railStyle = getComputedStyle(rail)
    const inputGroupRect = inputGroup.getBoundingClientRect()
    const inputGroupStyle = getComputedStyle(inputGroup)
    const textareaRect = textarea.getBoundingClientRect()
    const textareaStyle = getComputedStyle(textarea)
    const submitStyle = getComputedStyle(submit)
    const settingsRect = settings.getBoundingClientRect()
    const settingsStyle = getComputedStyle(settings)
    const modelSelectRect = modelSelect.getBoundingClientRect()
    const modelSelectStyle = getComputedStyle(modelSelect)
    const thinkingSelectRect = thinkingSelect.getBoundingClientRect()
    const thinkingSelectStyle = getComputedStyle(thinkingSelect)
    const footerControlsBelowComposer = Array.from(document.querySelectorAll<HTMLElement>('label, button, div'))
      .some((node) => /thinking control|light theme|dark theme/.test(node.textContent ?? '') && node.getBoundingClientRect().top > railRect.bottom)

    return {
      formClass: form.className,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      chat: {
        width: chatRect.width,
        bottom: chatRect.bottom,
      },
      rail: {
        width: railRect.width,
        height: railRect.height,
        bottom: railRect.bottom,
        multiline: rail.getAttribute('data-composer-multiline'),
        cssHeight: rail.style.getPropertyValue('--composer-input-group-height'),
        backgroundColor: railStyle.backgroundColor,
        boxShadow: railStyle.boxShadow,
        borderRadius: Number.parseFloat(railStyle.borderRadius),
        borderWidth: railStyle.borderWidth,
      },
      inputGroup: {
        height: inputGroupRect.height,
        backgroundColor: inputGroupStyle.backgroundColor,
        boxShadow: inputGroupStyle.boxShadow,
        borderRadius: Number.parseFloat(inputGroupStyle.borderRadius),
        borderWidth: inputGroupStyle.borderWidth,
        flexDirection: inputGroupStyle.flexDirection,
        alignItems: inputGroupStyle.alignItems,
      },
      textarea: {
        width: textareaRect.width,
        height: textareaRect.height,
        clientHeight: textarea.clientHeight,
        scrollHeight: textarea.scrollHeight,
        value: textarea.value,
        overflowY: textareaStyle.overflowY,
        flexGrow: textareaStyle.flexGrow,
        flexShrink: textareaStyle.flexShrink,
        minWidth: textareaStyle.minWidth,
        fieldSizing: (textareaStyle as CSSStyleDeclaration & { fieldSizing?: string }).fieldSizing ?? null,
        className: textarea.className,
      },
      submit: {
        backgroundColor: submitStyle.backgroundColor,
        color: submitStyle.color,
        className: submit.className,
        status: submit.getAttribute('data-boring-agent-submit-status'),
      },
      settings: {
        width: settingsRect.width,
        top: settingsRect.top,
        justifyContent: settingsStyle.justifyContent,
        gap: settingsStyle.gap,
        fontSize: settingsStyle.fontSize,
        color: settingsStyle.color,
      },
      modelSelect: {
        height: modelSelectRect.height,
        borderRadius: Number.parseFloat(modelSelectStyle.borderRadius),
      },
      thinkingSelect: {
        height: thinkingSelectRect.height,
        borderRadius: Number.parseFloat(thinkingSelectStyle.borderRadius),
      },
      footerControlsBelowComposer,
    }
  })
}

async function readMockState(page: Page): Promise<{ prompts: Array<Record<string, unknown>> }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __piNativeE2EState: () => { prompts: Array<Record<string, unknown>> } }).__piNativeE2EState()
    return { prompts: state.prompts }
  })
}

async function readMessageIds(page: Page): Promise<Array<string | null>> {
  return page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-boring-agent-message-id')),
  )
}
