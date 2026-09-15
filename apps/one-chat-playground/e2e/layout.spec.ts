import { expect, test, type Page } from '@playwright/test'

interface AppView { slug: string; title: string; url: string }

async function firstApp(page: Page): Promise<AppView> {
  const response = await page.request.get('/api/one-chat/apps')
  const body = await response.json() as { apps: AppView[] }
  if (body.apps[0]) return body.apps[0]
  const created = await page.request.post('/api/one-chat/apps', { data: { title: 'Starter app' }, timeout: 120_000 })
  expect(created.ok()).toBe(true)
  return created.json() as Promise<AppView>
}

async function installReplyEmitter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type LadderWindow = Window & {
      __oneChatReplyReady?: boolean
      __oneChatEmitReply?: (text: string) => boolean
    }
    const target = window as LadderWindow
    const nativeFetch = window.fetch.bind(window)
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let sequence = 0
    const encoder = new TextEncoder()

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/api\/v1\/agents\/default\/sessions\/[^/]+\/events\?cursor=/.test(url)) {
        const cursor = Number(new URL(url, window.location.href).searchParams.get('cursor'))
        if (Number.isFinite(cursor)) sequence = Math.max(sequence, cursor)
        return Promise.resolve(new Response(new ReadableStream<Uint8Array>({
          start(nextController) {
            controller = nextController
            target.__oneChatReplyReady = true
          },
        }), { headers: { 'content-type': 'application/x-ndjson' } }))
      }
      return nativeFetch(input, init)
    }) as typeof window.fetch

    target.__oneChatEmitReply = (text: string) => {
      if (!controller) return false
      const messageId = `ladder-assistant-${Date.now()}`
      const partId = `${messageId}:text`
      const emit = (frame: Record<string, unknown>) => {
        sequence += 1
        controller?.enqueue(encoder.encode(`${JSON.stringify({ ...frame, seq: sequence })}\n`))
      }
      emit({ type: 'message-start', messageId, role: 'assistant' })
      emit({ type: 'message-delta', messageId, partId, kind: 'text', delta: text })
      emit({ type: 'message-part-end', messageId, partId, kind: 'text', text })
      emit({
        type: 'message-end',
        messageId,
        final: {
          id: messageId,
          role: 'assistant',
          status: 'done',
          parts: [{ type: 'text', id: partId, text }],
        },
      })
      emit({ type: 'agent-end', turnId: `ladder-turn-${Date.now()}`, status: 'ok' })
      return true
    }
  })
}

test('desktop creates an app, keeps chat full width, then reveals a bridge-driven screen', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page).toHaveURL(/\/new/)
  await page.getByTestId('one-chat-create-form').getByLabel('App name').fill('Client portal')
  await page.getByTestId('one-chat-create-form').getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/apps\/client-portal(?:\?.*)?$/)

  const rail = page.getByTestId('one-chat-rail')
  const chat = page.getByTestId('one-chat-chat')
  await expect(rail).toBeVisible()
  await expect(page.getByRole('button', { name: 'Client portal' })).toBeVisible()
  await expect(chat).toBeVisible()
  await expect(page.getByTestId('one-chat-stage')).toHaveCount(0)

  const chatOnlyBox = (await chat.boundingBox())!
  expect(chatOnlyBox.x).toBeCloseTo(56, 0)
  expect(chatOnlyBox.width).toBeGreaterThan(1_150)
  await page.screenshot({ path: '.artifacts/chat-only-desktop.png' })
  await page.screenshot({ path: '.artifacts/rail-desktop.png' })

  const createdApp = await (await page.request.get('/api/one-chat/apps/client-portal')).json() as AppView
  let stageEventSent = false
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    if (stageEventSent) return route.continue()
    stageEventSent = true
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({
        type: 'stage.show',
        what: 'app',
        url: createdApp.url,
        title: 'Client portal',
      })}\n\n`,
    })
  })
  await page.reload()

  const stage = page.getByTestId('one-chat-stage')
  await expect(stage).toBeVisible()
  await expect(page.getByTestId('one-chat-base')).toBeVisible()
  const bar = page.getByTestId('one-chat-bar')
  await expect(bar).toBeVisible()
  const compactChatBox = (await chat.boundingBox())!
  const stageBox = (await stage.boundingBox())!
  expect(compactChatBox.width).toBeLessThan(chatOnlyBox.width)
  expect(stageBox.width).toBeGreaterThan(1_100)
  expect(compactChatBox.y).toBeGreaterThan(stageBox.height / 2)
})

test('desktop chat moves column → window → bar, peeks a reply, then docks again', async ({ page }) => {
  test.setTimeout(180_000)
  const app = await firstApp(page)
  await installReplyEmitter(page)
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'stage.show', what: 'app', url: app.url, title: app.title })}\n\n`,
    })
  })
  await page.goto(`/apps/${app.slug}`)
  await page.evaluate(({ slug }) => {
    window.localStorage.setItem(`one-chat:chat-presence:${slug}`, 'column')
  }, { slug: app.slug })
  await page.reload()

  const shell = page.getByTestId('one-chat-shell')
  const composer = page.getByRole('textbox', { name: 'Agent prompt' })
  await expect(shell).toHaveAttribute('data-chat-presence', 'column')
  await page.getByTestId('one-chat-column-to-window').click()
  await expect(shell).toHaveAttribute('data-chat-presence', 'window')
  await expect(page.getByTestId('one-chat-window')).toBeVisible()
  await expect(page.getByText('What would you like to build?')).toBeVisible()
  await page.screenshot({ path: '.artifacts/ladder-window.png' })

  const windowFrame = page.getByTestId('one-chat-window-frame')
  const windowHeader = windowFrame.locator('header')
  const frameBeforeDrag = await windowFrame.boundingBox()
  const headerBox = await windowHeader.boundingBox()
  expect(frameBeforeDrag).not.toBeNull()
  expect(headerBox).not.toBeNull()
  await page.mouse.move(headerBox!.x + headerBox!.width / 2, headerBox!.y + headerBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(headerBox!.x - 80, headerBox!.y + 60, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await windowFrame.boundingBox())?.x ?? 0).toBeLessThan(frameBeforeDrag!.x - 40)

  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(shell).toHaveAttribute('data-chat-presence', 'bar')
  await expect(page.getByTestId('one-chat-bar')).toBeVisible()
  await page.keyboard.press('/')
  await expect(page.getByRole('textbox', { name: 'Agent prompt' })).toBeFocused()
  await page.screenshot({ path: '.artifacts/ladder-bar.png' })

  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __oneChatReplyReady?: boolean }).__oneChatReplyReady))).toBe(true)
  const emitted = await page.evaluate(() => (
    window as Window & { __oneChatEmitReply?: (text: string) => boolean }
  ).__oneChatEmitReply?.('I updated the client list.'))
  expect(emitted).toBe(true)
  await expect(page.getByTestId('one-chat-reply-peek')).toContainText('I updated the client list.')
  await page.screenshot({ path: '.artifacts/ladder-peek.png' })

  await expect(page.getByTestId('one-chat-reply-peek')).toHaveCount(0, { timeout: 8_000 })
  await expect(page.getByTestId('one-chat-unseen')).toBeVisible()
  await page.getByTestId('one-chat-bar-expand').click()
  await expect(shell).toHaveAttribute('data-chat-presence', 'window')
  await composer.evaluate((input) => {
    input.addEventListener('keydown', (event) => event.preventDefault(), { once: true })
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await expect(shell).toHaveAttribute('data-chat-presence', 'window')
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-chat-presence', 'bar')
  await page.getByTestId('one-chat-bar-expand').click()
  await expect(shell).toHaveAttribute('data-chat-presence', 'window')
  await page.getByRole('button', { name: 'Dock panel' }).click()
  await expect(shell).toHaveAttribute('data-chat-presence', 'column')
  await expect.poll(() => page.evaluate(({ slug }) => (
    window.localStorage.getItem(`one-chat:chat-presence:${slug}`)
  ), { slug: app.slug })).toBe('column')
  await page.reload()
  await expect(shell).toHaveAttribute('data-chat-presence', 'column')

  await composer.fill('Keep this draft across every rung')
  await page.getByTestId('one-chat-column-to-window').click()
  await expect(composer).toHaveValue('Keep this draft across every rung')
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(composer).toHaveValue('Keep this draft across every rung')
  await page.getByTestId('one-chat-bar-expand').click()
  await page.getByRole('button', { name: 'Dock panel' }).click()
  await expect(composer).toHaveValue('Keep this draft across every rung')
  await composer.fill('')

  await page.getByTestId('one-chat-column-to-window').click()
  await page.getByRole('button', { name: 'Close panel' }).click()
  const roomyReply = await page.evaluate(() => (
    window as Window & { __oneChatEmitReply?: (text: string) => boolean }
  ).__oneChatEmitReply?.('The first line is ready.\nThere is more detail in the transcript.'))
  expect(roomyReply).toBe(true)
  await expect(shell).toHaveAttribute('data-chat-presence', 'window')
  await expect(page.getByTestId('one-chat-reply-peek')).toHaveCount(0)
})

test('a pending desktop question raises the chat from bar to window', async ({ page }) => {
  const app = await firstApp(page)
  await page.addInitScript(({ slug }) => {
    window.localStorage.setItem(`one-chat:chat-presence:${slug}`, 'bar')
  }, { slug: app.slug })
  await page.route('**/api/v1/questions/pending', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        questions: [{
          questionId: 'question-desktop-e2e',
          sessionId: 'one-chat',
          toolCallId: 'call-desktop-e2e',
          title: 'Keep this sketch?',
          answerToken: 'token-desktop-e2e',
          createdAt: '2026-09-15T12:00:00.000Z',
          schema: {
            wireVersion: 1,
            fields: [{
              type: 'radio',
              name: 'choice',
              label: 'Choose one',
              options: [
                { value: 'keep', label: 'Keep it' },
                { value: 'change', label: 'Change it' },
              ],
            }],
          },
        }],
      }),
    })
  })
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'stage.show', what: 'app', url: app.url, title: app.title })}\n\n`,
    })
  })
  await page.goto(`/apps/${app.slug}`)

  await expect(page.getByTestId('one-chat-shell')).toHaveAttribute('data-chat-presence', 'window')
  await expect(page.getByTestId('one-chat-window')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close panel' })).toHaveCount(0)
})

test('phone top bar opens the app sheet, creates an app, and Back restores the prior URL state', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.goto(`/apps/${app.slug}`)

  const topBar = page.getByTestId('one-chat-mobile-app-bar')
  await expect(topBar).toBeVisible()
  await topBar.click()
  const sheet = page.getByTestId('one-chat-app-sheet-layer')
  await expect(sheet).toBeVisible()
  const dialog = sheet.getByRole('dialog', { name: 'Your apps' })
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(sheet.getByRole('button', { name: app.title })).toHaveAttribute('aria-current', 'page')
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.screenshot({ path: '.artifacts/rail-phone-sheet.png' })

  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(topBar).toBeFocused()
  await topBar.click()

  await page.getByTestId('one-chat-app-sheet-layer').getByRole('button', { name: 'New app' }).click()
  await sheet.getByLabel('App name').fill('Pocket notes')
  await sheet.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/apps\/pocket-notes(?:\?.*)?$/)
  await expect(topBar).toContainText('Pocket notes')

  await page.goBack()
  await expect.poll(() => page.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get('panel'),
  }))).toEqual({ pathname: `/apps/${app.slug}`, panel: 'new' })
  await expect(page.getByTestId('one-chat-create-form')).toBeVisible()
})

test('closing a directly loaded app sheet stays inside One Chat', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.goto(`/apps/${app.slug}?panel=apps`)

  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await expect.poll(() => page.evaluate(() => ({
    pathname: window.location.pathname,
    panel: new URLSearchParams(window.location.search).get('panel'),
  }))).toEqual({ pathname: `/apps/${app.slug}`, panel: null })
  await expect(page.getByTestId('one-chat-app-sheet-layer')).toHaveCount(0)
})

test('a pending question opens phone chat to at least half when a screen is visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await firstApp(page)
  await page.route('**/api/v1/questions/pending', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        questions: [{
          questionId: 'question-e2e',
          sessionId: 'one-chat',
          toolCallId: 'call-e2e',
          title: 'Keep this sketch?',
          answerToken: 'token-e2e',
          createdAt: '2026-09-15T12:00:00.000Z',
          schema: {
            wireVersion: 1,
            fields: [{
              type: 'radio',
              name: 'choice',
              label: 'Choose one',
              options: [
                { value: 'keep', label: 'Keep it (recommended)' },
                { value: 'change', label: 'Change it' },
              ],
            }],
          },
        }],
      }),
    })
  })
  await page.route('**/api/one-chat/stage/stream?app=*', async (route) => {
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'stage.show', what: 'app', url: app.url, title: app.title })}\n\n`,
    })
  })
  await page.goto(`/apps/${app.slug}`)

  await expect(page.getByTestId('one-chat-mobile-sheet')).not.toHaveAttribute('aria-hidden', 'true')
  const sheetBox = (await page.getByTestId('one-chat-mobile-sheet').boundingBox())!
  expect(sheetBox.height).toBeGreaterThanOrEqual(390)
})
