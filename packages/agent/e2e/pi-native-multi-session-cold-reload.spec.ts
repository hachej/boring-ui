import type { Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './fixtures'
import { assertChatDomInvariants, readChatDomState } from './helpers/chat-state'
import { navigateBrowserToBackend } from './helpers/browser'
import { formatLogs, spawnBackend } from './helpers/backend'
import { installPiNativeMock } from './pi-native-mock'

const ACTIVE_SESSION_KEY = 'boring-agent:v2:agent-playground:activeSessionId'
const STORAGE_SCOPE = 'agent-playground'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

test.describe('Pi-native multi-session cold reload', () => {
  test('retries transient session-list 503s without switching or auto-creating the selected session', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript((activeSessionKey) => {
      localStorage.setItem(activeSessionKey, 'cold-selected')
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
        sessionList503Remaining: 2,
        sessionListRequests: 0,
        sessionList503Served: 0,
        sessionCreates: 0,
        sessions: [
          {
            id: 'cold-newest',
            title: 'Newer cold session',
            createdAt: '2026-06-04T00:00:00.000Z',
            updatedAt: '2026-06-04T00:10:00.000Z',
            turnCount: 2,
          },
          {
            id: 'cold-selected',
            title: 'Selected cold session',
            createdAt: '2026-06-03T00:00:00.000Z',
            updatedAt: '2026-06-03T00:10:00.000Z',
            turnCount: 2,
          },
          {
            id: 'cold-oldest',
            title: 'Older cold session',
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:10:00.000Z',
            turnCount: 2,
          },
        ],
        sessionStates: {
          'cold-newest': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'cold-newest-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'cold-newest-u1:text', text: '<redacted newest prompt>' }] },
              { id: 'cold-newest-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'cold-newest-a1:text', text: 'COLD_NEWEST_ONLY' }] },
            ],
            queue: { followUps: [] },
          },
          'cold-selected': {
            seq: 4,
            status: 'idle',
            messages: [
              { id: 'cold-selected-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'cold-selected-u1:text', text: '<redacted selected prompt>' }] },
              { id: 'cold-selected-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'cold-selected-a1:text', text: 'COLD_SELECTED_VISIBLE' }] },
            ],
            queue: { followUps: [] },
          },
          'cold-oldest': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'cold-oldest-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'cold-oldest-u1:text', text: '<redacted oldest prompt>' }] },
              { id: 'cold-oldest-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'cold-oldest-a1:text', text: 'COLD_OLDEST_ONLY' }] },
            ],
            queue: { followUps: [] },
          },
        },
      }))
    }, ACTIVE_SESSION_KEY)

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    await assertSelectedColdSession(page)

    await page.reload({ waitUntil: 'domcontentloaded' })

    await assertSelectedColdSession(page)

    const state = await page.evaluate(() => (window as unknown as { __piNativeE2EState: () => {
      sessionListRequests?: number
      sessionList503Served?: number
      sessionCreates?: number
    } }).__piNativeE2EState())
    expect(state.sessionListRequests).toBeGreaterThanOrEqual(3)
    expect(state.sessionList503Served).toBe(2)
    expect(state.sessionCreates ?? 0).toBe(0)

    await testInfo.attach('pi-native-multi-session-cold-reload.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'multi-session-cold-reload',
        sessionListRequests: state.sessionListRequests,
        sessionList503Served: state.sessionList503Served,
        sessionCreates: state.sessionCreates ?? 0,
        messages: await page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) => nodes.map((node) => ({
          id: node.getAttribute('data-boring-agent-message-id'),
          role: node.getAttribute('data-boring-agent-message-role'),
          text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        }))),
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('real runtime retries reload-time session-list 503s without switching or auto-creating the selected session', async ({ page, workspace }, testInfo) => {
    const backend = await spawnBackend({
      workspaceRoot: workspace.root,
      repoRoot,
      env: {
        BORING_AGENT_E2E_SCRIPTED_PI: '1',
      },
    })
    const sessionListStatuses: number[] = []
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/api/v1/agent/pi-chat/sessions') {
        sessionListStatuses.push(response.status())
      }
    })

    try {
      await clearSessions(backend.apiUrl)
      const older = await createPiSession(backend.apiUrl, 'Older runtime session')
      const selected = await createPiSession(backend.apiUrl, 'Selected runtime session')
      const newer = await createPiSession(backend.apiUrl, 'Newer runtime session')
      await seedSelectedSession(backend.apiUrl, selected.id)
      await page.addInitScript(([activeSessionKey, activeSessionId]) => {
        localStorage.setItem(activeSessionKey, activeSessionId)
      }, [ACTIVE_SESSION_KEY, selected.id])

      await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)
      await assertSelectedRuntimeSession(page, selected.id, [
        newer.title,
        selected.title,
        older.title,
      ])
      expect(sessionListStatuses).toContain(200)
      expect(sessionListStatuses.filter((status) => status === 503)).toHaveLength(0)

      sessionListStatuses.length = 0
      let transientFailuresRemaining = 2
      // Match the list endpoint with or without its ?activeSessionId=… query
      // (but not /sessions/<id>/… subpaths), so the 503 injection still fires.
      await page.route(/\/api\/v1\/agent\/pi-chat\/sessions(\?|$)/, async (route) => {
        if (transientFailuresRemaining > 0) {
          transientFailuresRemaining -= 1
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'AGENT_RUNTIME_NOT_READY',
                message: 'Agent runtime is still preparing. Try again in a moment.',
                retryable: true,
              },
            }),
          })
          return
        }
        await route.continue()
      })
      await page.reload({ waitUntil: 'domcontentloaded' })

      await assertSelectedRuntimeSession(page, selected.id, [
        newer.title,
        selected.title,
        older.title,
      ])
      expect(sessionListStatuses.filter((status) => status === 503)).toHaveLength(2)
      expect(sessionListStatuses.at(-1)).toBe(200)

      const remaining = await listPiSessions(backend.apiUrl)
      expect(remaining.map((session) => session.id).sort()).toEqual([
        newer.id,
        older.id,
        selected.id,
      ].sort())

      await testInfo.attach('pi-native-multi-session-real-cold-reload.json', {
        body: Buffer.from(JSON.stringify({
          checkpoint: 'multi-session-real-cold-reload',
          sessionListStatuses,
          selectedSessionId: selected.id,
          remainingSessions: remaining,
        }, null, 2), 'utf8'),
        contentType: 'application/json',
      })
    } finally {
      await testInfo.attach('backend-stdout.log', {
        body: Buffer.from(`${backend.logs.stdout.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      await testInfo.attach('backend-stderr.log', {
        body: Buffer.from(`${backend.logs.stderr.join('\n')}\n`, 'utf8'),
        contentType: 'text/plain',
      })
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('backend-combined.log', {
          body: Buffer.from(formatLogs(backend.logs), 'utf8'),
          contentType: 'text/plain',
        })
      }
      await backend.stop()
    }
  })
})

async function assertSelectedColdSession(page: Page): Promise<void> {
  const chat = page.locator('[data-boring-agent-part="chat"]')
  const conversation = page.getByLabel('Agent conversation')
  const rows = page.locator('[data-boring-agent-part="session-row"]')

  await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'cold-selected', { timeout: 10_000 })
  await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
  await expect(rows).toHaveCount(3, { timeout: 10_000 })
  await expect(rows.nth(0)).toContainText('Newer cold session')
  await expect(rows.nth(1)).toContainText('Selected cold session')
  await expect(rows.nth(2)).toContainText('Older cold session')
  await expect(rows.filter({ hasText: 'Selected cold session' })).toHaveAttribute('data-boring-state', 'selected')
  await expect(rows.filter({ hasText: 'Newer cold session' })).not.toHaveAttribute('data-boring-state', 'selected')
  await expect(conversation.getByText('COLD_SELECTED_VISIBLE')).toBeVisible({ timeout: 10_000 })
  await expect(conversation.getByText('COLD_NEWEST_ONLY')).toHaveCount(0)
  await expect(conversation.getByText('COLD_OLDEST_ONLY')).toHaveCount(0)
  assertChatDomInvariants(await readChatDomState(page))
}

interface RuntimeSessionSummary {
  id: string
  title: string
}

async function clearSessions(apiUrl: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/agent/pi-chat/sessions`)
  expect(response.status).toBe(200)
  const sessions = await response.json() as RuntimeSessionSummary[]
  for (const session of sessions) {
    const deleted = await fetch(`${apiUrl}/api/v1/agent/pi-chat/sessions/${encodeURIComponent(session.id)}`, {
      method: 'DELETE',
    })
    expect([204, 404]).toContain(deleted.status)
  }
}

async function createPiSession(apiUrl: string, title: string): Promise<RuntimeSessionSummary> {
  const response = await fetch(`${apiUrl}/api/v1/agent/pi-chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-boring-storage-scope': STORAGE_SCOPE,
    },
    body: JSON.stringify({ title }),
  })
  expect(response.status).toBe(201)
  return await response.json() as RuntimeSessionSummary
}

async function listPiSessions(apiUrl: string): Promise<RuntimeSessionSummary[]> {
  const response = await fetch(`${apiUrl}/api/v1/agent/pi-chat/sessions`, {
    headers: { 'x-boring-storage-scope': STORAGE_SCOPE },
  })
  expect(response.status).toBe(200)
  return await response.json() as RuntimeSessionSummary[]
}

async function seedSelectedSession(apiUrl: string, sessionId: string): Promise<void> {
  const prompt = await fetch(`${apiUrl}/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-boring-storage-scope': STORAGE_SCOPE,
    },
    body: JSON.stringify({
      message: 'seed selected runtime transcript',
      clientNonce: 'seed-selected-runtime-transcript',
    }),
  })
  expect(prompt.status).toBe(202)

  await expect.poll(async () => {
    const state = await fetch(`${apiUrl}/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/state`, {
      headers: { 'x-boring-storage-scope': STORAGE_SCOPE },
    })
    if (state.status !== 200) return false
    const body = await state.json() as { status?: string; messages?: Array<{ role?: string; parts?: Array<{ text?: string }> }> }
    return body.status === 'idle' && body.messages?.some((message) => (
      message.role === 'assistant' &&
      message.parts?.some((part) => part.text?.includes('PI_NATIVE_ASSISTANT_DONE'))
    )) === true
  }, {
    message: `expected seeded Pi session ${sessionId} to complete before browser hydration`,
    timeout: 15_000,
  }).toBe(true)
}

async function assertSelectedRuntimeSession(page: Page, selectedId: string, expectedTitles: string[]): Promise<void> {
  const chat = page.locator('[data-boring-agent-part="chat"]')
  const rows = page.locator('[data-boring-agent-part="session-row"]')

  await expect(chat).toHaveAttribute('data-pi-chat-session-id', selectedId, { timeout: 10_000 })
  await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
  await expect(rows).toHaveCount(expectedTitles.length, { timeout: 10_000 })
  for (const title of expectedTitles) {
    await expect(rows.filter({ hasText: title })).toHaveCount(1)
  }
  await expect(rows.filter({ hasText: 'Selected runtime session' })).toHaveAttribute('data-boring-state', 'selected')
  await expect(rows.filter({ hasText: 'Newer runtime session' })).not.toHaveAttribute('data-boring-state', 'selected')
  await expect(rows.filter({ hasText: 'Older runtime session' })).not.toHaveAttribute('data-boring-state', 'selected')
  assertChatDomInvariants(await readChatDomState(page))
}
