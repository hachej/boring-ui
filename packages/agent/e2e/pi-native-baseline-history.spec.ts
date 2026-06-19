import { expect, test } from './fixtures'
import { navigateBrowserToBackend } from './helpers/browser'
import { installPiNativeMock } from './pi-native-mock'

test.describe('Pi-native baseline session history', () => {
  test('sorts session history and isolates transcripts while switching sessions', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
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
          { id: 'history-old', title: 'Older transcript', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:05:00.000Z', turnCount: 2 },
          { id: 'history-new', title: 'Newest transcript', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-04T00:05:00.000Z', turnCount: 2 },
          { id: 'history-mid', title: 'Middle transcript', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-03T00:05:00.000Z', turnCount: 2 },
        ],
        sessionStates: {
          'history-old': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'old-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'old-u1:text', text: '<redacted old prompt>' }] },
              { id: 'old-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'old-a1:text', text: 'OLD_TRANSCRIPT_ONLY' }] },
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
          'history-new': {
            seq: 4,
            status: 'idle',
            messages: [
              { id: 'new-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'new-u1:text', text: '<redacted new prompt>' }] },
              { id: 'new-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'new-a1:text', text: 'NEW_TRANSCRIPT_ONLY' }] },
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
          'history-mid': {
            seq: 3,
            status: 'idle',
            messages: [
              { id: 'mid-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'mid-u1:text', text: '<redacted mid prompt>' }] },
              { id: 'mid-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'mid-a1:text', text: 'MID_TRANSCRIPT_ONLY' }] },
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

    const conversation = page.getByLabel('Agent conversation')
    const chat = page.locator('[data-boring-agent-part="chat"]')
    const rows = page.locator('[data-boring-agent-part="session-row"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'history-old', { timeout: 10_000 })
    await expect(conversation.getByText('OLD_TRANSCRIPT_ONLY')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('NEW_TRANSCRIPT_ONLY')).toHaveCount(0)

    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Newest transcript')
    await expect(rows.nth(1)).toContainText('Middle transcript')
    await expect(rows.nth(2)).toContainText('Older transcript')
    await expect(rows.filter({ hasText: 'Older transcript' })).toHaveAttribute('data-boring-state', 'selected')

    await rows.filter({ hasText: 'Newest transcript' }).click()

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'history-new', { timeout: 10_000 })
    await expect(conversation.getByText('NEW_TRANSCRIPT_ONLY')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('OLD_TRANSCRIPT_ONLY')).toHaveCount(0)
    await expect(rows.filter({ hasText: 'Newest transcript' })).toHaveAttribute('data-boring-state', 'selected')
    await expect(rows.filter({ hasText: 'Older transcript' })).not.toHaveAttribute('data-boring-state', 'selected')

    const summary = await rows.evaluateAll((nodes) => nodes.map((node) => ({
      state: node.getAttribute('data-boring-state'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })))
    await testInfo.attach('pi-native-baseline-history.json', {
      body: Buffer.from(JSON.stringify({ checkpoint: 'T9', rows: summary }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('ignores stale streaming events after switching away from an active session', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
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
          { id: 'switch-old', title: 'Streaming old session', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:05:00.000Z', turnCount: 2 },
          { id: 'switch-new', title: 'Selected new session', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-04T00:05:00.000Z', turnCount: 2 },
        ],
        sessionStates: {
          'switch-old': {
            seq: 4,
            status: 'streaming',
            messages: [
              { id: 'switch-old-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'switch-old-u1:text', text: '<redacted old active prompt>' }] },
              { id: 'switch-old-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'switch-old-a1:text', text: 'OLD_ACTIVE_STREAM_VISIBLE' }] },
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
          'switch-new': {
            seq: 10,
            status: 'idle',
            messages: [
              { id: 'switch-new-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'switch-new-u1:text', text: '<redacted selected prompt>' }] },
              { id: 'switch-new-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'switch-new-a1:text', text: 'NEW_SELECTED_BASELINE' }] },
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

    const conversation = page.getByLabel('Agent conversation')
    const chat = page.locator('[data-boring-agent-part="chat"]')
    const rows = page.locator('[data-boring-agent-part="session-row"]')

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'switch-old', { timeout: 10_000 })
    await expect(conversation.getByText('OLD_ACTIVE_STREAM_VISIBLE')).toBeVisible({ timeout: 10_000 })

    await rows.filter({ hasText: 'Selected new session' }).click()

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'switch-new', { timeout: 10_000 })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(conversation.getByText('NEW_SELECTED_BASELINE')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('OLD_ACTIVE_STREAM_VISIBLE')).toHaveCount(0)

    await page.evaluate(() => {
      const emit = (window as unknown as { __piNativeE2EEmit: (sessionId: string, frame: unknown) => void }).__piNativeE2EEmit
      emit('switch-old', { type: 'message-start', seq: 5, messageId: 'switch-old-stale', role: 'assistant' })
      emit('switch-old', { type: 'message-delta', seq: 6, messageId: 'switch-old-stale', partId: 'switch-old-stale:text', kind: 'text', delta: 'OLD_STALE_AFTER_SWITCH' })
      emit('switch-new', { type: 'message-start', seq: 11, messageId: 'switch-new-live', role: 'assistant' })
      emit('switch-new', { type: 'message-delta', seq: 12, messageId: 'switch-new-live', partId: 'switch-new-live:text', kind: 'text', delta: 'NEW_LIVE_AFTER_SWITCH' })
    })

    await expect(conversation.getByText('NEW_LIVE_AFTER_SWITCH')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('OLD_STALE_AFTER_SWITCH')).toHaveCount(0)

    const visibleMessages = await page.locator('[data-boring-agent-part="message"]').evaluateAll((nodes) => nodes.map((node) => ({
      id: node.getAttribute('data-boring-agent-message-id'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })))
    await testInfo.attach('pi-native-baseline-active-switch.json', {
      body: Buffer.from(JSON.stringify({ checkpoint: 'T9-active-switch', visibleMessages }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('preserves active transcript order when session metadata refreshes', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
      const stateKey = '__boring_pi_native_e2e_state__'
      if (!localStorage.getItem(stateKey)) {
        localStorage.setItem(stateKey, JSON.stringify({
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
            { id: 'metadata-neighbor', title: 'Neighbor session', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-04T00:05:00.000Z', turnCount: 2 },
            { id: 'metadata-active', title: 'Baseline active session', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-03T00:05:00.000Z', turnCount: 4 },
            { id: 'metadata-old', title: 'Older sibling session', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:05:00.000Z', turnCount: 2 },
          ],
          sessionStates: {
            'metadata-active': {
              seq: 4,
              status: 'idle',
              messages: [
                { id: 'metadata-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'metadata-u1:text', text: '<redacted active prompt one>' }] },
                { id: 'metadata-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'metadata-a1:text', text: 'ACTIVE_HISTORY_REPLY_ONE' }] },
                { id: 'metadata-u2', role: 'user', status: 'done', parts: [{ type: 'text', id: 'metadata-u2:text', text: '<redacted active prompt two>' }] },
                { id: 'metadata-a2', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'metadata-a2:text', text: 'ACTIVE_HISTORY_REPLY_TWO' }] },
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
            'metadata-neighbor': {
              seq: 2,
              status: 'idle',
              messages: [
                { id: 'metadata-neighbor-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'metadata-neighbor-u1:text', text: '<redacted neighbor prompt>' }] },
                { id: 'metadata-neighbor-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'metadata-neighbor-a1:text', text: 'NEIGHBOR_TRANSCRIPT_ONLY' }] },
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
            'metadata-old': {
              seq: 2,
              status: 'idle',
              messages: [
                { id: 'metadata-old-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'metadata-old-u1:text', text: '<redacted old prompt>' }] },
                { id: 'metadata-old-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'metadata-old-a1:text', text: 'OLD_METADATA_TRANSCRIPT_ONLY' }] },
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
      }
      localStorage.setItem('boring-agent:v2:agent-playground:activeSessionId', 'metadata-active')
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    const conversation = page.getByLabel('Agent conversation')
    const chat = page.locator('[data-boring-agent-part="chat"]')
    const rows = page.locator('[data-boring-agent-part="session-row"]')
    const selectedRows = page.locator('[data-boring-agent-part="session-row"][data-boring-state="selected"]')
    const messages = page.locator('[data-boring-agent-part="message"]')
    const expectedMessageIds = ['metadata-u1', 'metadata-a1', 'metadata-u2', 'metadata-a2']

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'metadata-active', { timeout: 10_000 })
    await expect(conversation.getByText('ACTIVE_HISTORY_REPLY_TWO')).toBeVisible({ timeout: 10_000 })
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Neighbor session')
    await expect(rows.nth(1)).toContainText('Baseline active session')
    await expect(rows.filter({ hasText: 'Baseline active session' })).toHaveCount(1)
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toContainText('Baseline active session')
    await expect(messages).toHaveCount(expectedMessageIds.length)

    const beforeIds = await messages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-boring-agent-message-id')))
    expect(beforeIds).toEqual(expectedMessageIds)

    await page.evaluate(() => {
      const stateKey = '__boring_pi_native_e2e_state__'
      const raw = localStorage.getItem(stateKey)
      if (!raw) throw new Error('missing pi native state')
      const state = JSON.parse(raw) as { sessions: Array<{ id: string; title: string; updatedAt: string }> }
      state.sessions = state.sessions.map((session) => (
        session.id === 'metadata-active'
          ? { ...session, title: 'Baseline active renamed', updatedAt: '2026-06-05T00:05:00.000Z' }
          : session
      ))
      localStorage.setItem(stateKey, JSON.stringify(state))
    })

    await page.reload()

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'metadata-active', { timeout: 10_000 })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(conversation.getByText('ACTIVE_HISTORY_REPLY_TWO')).toBeVisible({ timeout: 10_000 })
    await expect(conversation.getByText('NEIGHBOR_TRANSCRIPT_ONLY')).toHaveCount(0)
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Baseline active renamed')
    await expect(rows.filter({ hasText: 'Baseline active renamed' })).toHaveCount(1)
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toContainText('Baseline active renamed')
    await expect(messages).toHaveCount(expectedMessageIds.length)

    const afterIds = await messages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-boring-agent-message-id')))
    expect(afterIds).toEqual(expectedMessageIds)

    const rowsSummary = await rows.evaluateAll((nodes) => nodes.map((node, index) => ({
      index,
      state: node.getAttribute('data-boring-state'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })))
    await testInfo.attach('pi-native-baseline-active-metadata-refresh.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T9-active-metadata-refresh',
        beforeIds,
        afterIds,
        rows: rowsSummary,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })

  test('refreshes active session metadata live after the turn settles', async ({ page, backend }, testInfo) => {
    await installPiNativeMock(page)
    await page.addInitScript(() => {
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
          { id: 'live-neighbor', title: 'Live neighbor session', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-04T00:05:00.000Z', turnCount: 2 },
          { id: 'live-active', title: 'Live active session', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-03T00:05:00.000Z', turnCount: 2 },
          { id: 'live-old', title: 'Live older session', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:05:00.000Z', turnCount: 2 },
        ],
        sessionStates: {
          'live-active': {
            seq: 4,
            status: 'streaming',
            messages: [
              { id: 'live-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'live-u1:text', text: '<redacted live prompt>' }] },
              { id: 'live-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'live-a1:text', text: 'LIVE_ACTIVE_TRANSCRIPT_ONLY' }] },
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
          'live-neighbor': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'live-neighbor-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'live-neighbor-u1:text', text: '<redacted neighbor prompt>' }] },
              { id: 'live-neighbor-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'live-neighbor-a1:text', text: 'LIVE_NEIGHBOR_TRANSCRIPT_ONLY' }] },
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
          'live-old': {
            seq: 2,
            status: 'idle',
            messages: [
              { id: 'live-old-u1', role: 'user', status: 'done', parts: [{ type: 'text', id: 'live-old-u1:text', text: '<redacted old prompt>' }] },
              { id: 'live-old-a1', role: 'assistant', status: 'done', parts: [{ type: 'text', id: 'live-old-a1:text', text: 'LIVE_OLD_TRANSCRIPT_ONLY' }] },
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
      localStorage.setItem('boring-agent:v2:agent-playground:activeSessionId', 'live-active')
    })

    await navigateBrowserToBackend(page, `${backend.browserUrl}?piNative=1&showSessions=1`)

    const conversation = page.getByLabel('Agent conversation')
    const chat = page.locator('[data-boring-agent-part="chat"]')
    const rows = page.locator('[data-boring-agent-part="session-row"]')
    const selectedRows = page.locator('[data-boring-agent-part="session-row"][data-boring-state="selected"]')
    const messages = page.locator('[data-boring-agent-part="message"]')
    const expectedMessageIds = ['live-u1', 'live-a1']

    await expect(chat).toHaveAttribute('data-pi-chat-session-id', 'live-active', { timeout: 10_000 })
    await expect(chat).toHaveAttribute('data-pi-chat-connection', 'connected', { timeout: 10_000 })
    await expect(conversation.getByText('LIVE_ACTIVE_TRANSCRIPT_ONLY')).toBeVisible({ timeout: 10_000 })
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Live neighbor session')
    await expect(rows.nth(1)).toContainText('Live active session')
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toContainText('Live active session')

    const beforeIds = await messages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-boring-agent-message-id')))
    expect(beforeIds).toEqual(expectedMessageIds)

    await page.evaluate(() => {
      const stateKey = '__boring_pi_native_e2e_state__'
      const raw = localStorage.getItem(stateKey)
      if (!raw) throw new Error('missing pi native state')
      const state = JSON.parse(raw) as { sessions: Array<{ id: string; title: string; updatedAt: string; turnCount: number }> }
      state.sessions = state.sessions.map((session) => (
        session.id === 'live-active'
          ? { ...session, title: 'Live active renamed', updatedAt: '2026-06-05T00:05:00.000Z', turnCount: 4 }
          : session
      ))
      localStorage.setItem(stateKey, JSON.stringify(state))
      const emit = (window as unknown as { __piNativeE2EEmit: (sessionId: string, frame: unknown) => void }).__piNativeE2EEmit
      emit('live-active', { type: 'agent-end', seq: 5, turnId: 'turn-live-refresh', status: 'ok' })
    })

    await expect(rows.nth(0)).toContainText('Live active renamed', { timeout: 10_000 })
    await expect(rows.filter({ hasText: 'Live active renamed' })).toHaveCount(1)
    await expect(selectedRows).toHaveCount(1)
    await expect(selectedRows).toContainText('Live active renamed')
    await expect(conversation.getByText('LIVE_NEIGHBOR_TRANSCRIPT_ONLY')).toHaveCount(0)
    await expect(messages).toHaveCount(expectedMessageIds.length)

    const afterIds = await messages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-boring-agent-message-id')))
    expect(afterIds).toEqual(expectedMessageIds)

    const rowsSummary = await rows.evaluateAll((nodes) => nodes.map((node, index) => ({
      index,
      state: node.getAttribute('data-boring-state'),
      text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })))
    await testInfo.attach('pi-native-baseline-active-live-metadata-refresh.json', {
      body: Buffer.from(JSON.stringify({
        checkpoint: 'T9-active-live-metadata-refresh',
        beforeIds,
        afterIds,
        rows: rowsSummary,
      }, null, 2), 'utf8'),
      contentType: 'application/json',
    })
  })
})
