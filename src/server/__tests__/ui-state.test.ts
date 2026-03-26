import { describe, it, expect } from 'vitest'
import { createApp } from '../app.js'
import { testSessionCookie, TEST_SECRET } from './helpers.js'
import { loadConfig } from '../config.js'

let appCounter = 0

function getApp() {
  appCounter += 1
  return createApp({
    config: {
      ...loadConfig(),
      sessionSecret: TEST_SECRET,
      workspaceRoot: `/tmp/boring-ui-ui-state-${appCounter}`,
    } as any,
    skipValidation: true,
  })
}

const WORKSPACE_A = '11111111-1111-1111-1111-111111111111'
const WORKSPACE_B = '22222222-2222-2222-2222-222222222222'

describe('UI State routes', () => {
  it('stores Python-compatible snapshots and returns the latest state', async () => {
    const app = getApp()
    const token = await testSessionCookie()

    const payload = {
      client_id: 'client-1',
      project_root: '/workspace/demo',
      active_panel_id: 'pane-orders',
      open_panels: [
        { id: 'pane-orders', component: 'orders-grid', title: 'Orders' },
        { id: 'pane-chart', component: 'chart-canvas', title: 'OHLC' },
      ],
      meta: { pane_count: 2 },
      custom_payload: { opaque: true },
    }

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/state',
      cookies: { boring_session: token },
      payload,
    })
    expect(putRes.statusCode).toBe(200)
    expect(JSON.parse(putRes.payload)).toMatchObject({
      ok: true,
      state: {
        client_id: 'client-1',
        active_panel_id: 'pane-orders',
        open_panels: payload.open_panels,
        custom_payload: { opaque: true },
      },
    })

    const latestRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/state/latest',
      cookies: { boring_session: token },
    })
    expect(latestRes.statusCode).toBe(200)
    expect(JSON.parse(latestRes.payload)).toMatchObject({
      ok: true,
      state: {
        client_id: 'client-1',
        active_panel_id: 'pane-orders',
        open_panels: payload.open_panels,
      },
    })

    await app.close()
  })

  it('returns 404s when no state exists yet', async () => {
    const app = getApp()
    const token = await testSessionCookie()

    const latestRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/state/latest',
      cookies: { boring_session: token },
    })
    expect(latestRes.statusCode).toBe(404)

    const panesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/panes',
      cookies: { boring_session: token },
    })
    expect(panesRes.statusCode).toBe(404)

    await app.close()
  })

  it('lists open panes and enqueues Python-compatible commands per client', async () => {
    const app = getApp()
    const token = await testSessionCookie()

    await app.inject({
      method: 'PUT',
      url: '/api/v1/ui/state',
      cookies: { boring_session: token },
      payload: {
        client_id: 'client-cmd',
        active_panel_id: 'pane-orders',
        open_panels: [
          { id: 'pane-orders', component: 'orders-grid', params: { sort: 'desc' } },
          { id: 'editor-README.md', component: 'editor', title: 'README.md', params: { path: 'README.md' } },
        ],
      },
    })

    const panesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/panes',
      cookies: { boring_session: token },
    })
    expect(panesRes.statusCode).toBe(200)
    expect(JSON.parse(panesRes.payload)).toMatchObject({
      ok: true,
      client_id: 'client-cmd',
      active_panel_id: 'pane-orders',
      count: 2,
      open_panels: [
        expect.objectContaining({ id: 'pane-orders' }),
        expect.objectContaining({ id: 'editor-README.md' }),
      ],
    })

    const focusRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/focus',
      cookies: { boring_session: token },
      payload: { client_id: 'client-cmd', panel_id: 'pane-orders' },
    })
    expect(focusRes.statusCode).toBe(200)
    expect(JSON.parse(focusRes.payload)).toMatchObject({
      ok: true,
      command: {
        client_id: 'client-cmd',
        command: { kind: 'focus_panel', panel_id: 'pane-orders' },
      },
    })

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/commands',
      cookies: { boring_session: token },
      payload: {
        client_id: 'client-cmd',
        command: {
          kind: 'open_panel',
          panel_id: 'editor-src/index.ts',
          component: 'editor',
          title: 'index.ts',
          params: { path: 'src/index.ts' },
        },
      },
    })
    expect(openRes.statusCode).toBe(200)
    expect(JSON.parse(openRes.payload)).toMatchObject({
      ok: true,
      command: {
        client_id: 'client-cmd',
        command: {
          kind: 'open_panel',
          panel_id: 'editor-src/index.ts',
          component: 'editor',
        },
      },
    })

    const legacyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ui/commands',
      cookies: { boring_session: token },
      payload: {
        client_id: 'client-cmd',
        type: 'open_panel',
        payload: {
          panel_id: 'editor-package.json',
          component: 'editor',
          title: 'package.json',
          params: { path: 'package.json' },
        },
      },
    })
    expect(legacyRes.statusCode).toBe(200)
    expect(JSON.parse(legacyRes.payload).command.command.kind).toBe('open_panel')

    const firstNext = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/commands/next?client_id=client-cmd',
      cookies: { boring_session: token },
    })
    expect(firstNext.statusCode).toBe(200)
    expect(JSON.parse(firstNext.payload).command.command.kind).toBe('focus_panel')

    const secondNext = await app.inject({
      method: 'GET',
      url: '/api/v1/ui/commands/next?client_id=client-cmd',
      cookies: { boring_session: token },
    })
    expect(secondNext.statusCode).toBe(200)
    expect(JSON.parse(secondNext.payload).command.command.kind).toBe('open_panel')

    await app.close()
  })

  it('isolates state and command queues across workspace-boundary routes', async () => {
    const app = getApp()
    const token = await testSessionCookie()

    const stateARes = await app.inject({
      method: 'PUT',
      url: `/w/${WORKSPACE_A}/api/v1/ui/state`,
      cookies: { boring_session: token },
      payload: {
        client_id: 'shared-client',
        active_panel_id: 'pane-a',
        open_panels: [{ id: 'pane-a', component: 'editor', params: { path: 'a.txt' } }],
      },
    })
    expect(stateARes.statusCode).toBe(200)

    const stateBRes = await app.inject({
      method: 'PUT',
      url: `/w/${WORKSPACE_B}/api/v1/ui/state`,
      cookies: { boring_session: token },
      payload: {
        client_id: 'shared-client',
        active_panel_id: 'pane-b',
        open_panels: [{ id: 'pane-b', component: 'editor', params: { path: 'b.txt' } }],
      },
    })
    expect(stateBRes.statusCode).toBe(200)

    const panesARes = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_A}/api/v1/ui/panes/shared-client`,
      cookies: { boring_session: token },
    })
    expect(panesARes.statusCode).toBe(200)
    expect(JSON.parse(panesARes.payload)).toMatchObject({
      client_id: 'shared-client',
      active_panel_id: 'pane-a',
      open_panels: [expect.objectContaining({ id: 'pane-a' })],
    })

    const panesBRes = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_B}/api/v1/ui/panes/shared-client`,
      cookies: { boring_session: token },
    })
    expect(panesBRes.statusCode).toBe(200)
    expect(JSON.parse(panesBRes.payload)).toMatchObject({
      client_id: 'shared-client',
      active_panel_id: 'pane-b',
      open_panels: [expect.objectContaining({ id: 'pane-b' })],
    })

    await app.inject({
      method: 'POST',
      url: `/w/${WORKSPACE_A}/api/v1/ui/commands`,
      cookies: { boring_session: token },
      payload: {
        client_id: 'shared-client',
        command: {
          kind: 'open_panel',
          panel_id: 'editor-a2',
          component: 'editor',
          params: { path: 'a2.txt' },
        },
      },
    })

    const nextARes = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_A}/api/v1/ui/commands/next?client_id=shared-client`,
      cookies: { boring_session: token },
    })
    expect(nextARes.statusCode).toBe(200)
    expect(JSON.parse(nextARes.payload)).toMatchObject({
      command: {
        client_id: 'shared-client',
        command: { panel_id: 'editor-a2' },
      },
    })

    const nextBRes = await app.inject({
      method: 'GET',
      url: `/w/${WORKSPACE_B}/api/v1/ui/commands/next?client_id=shared-client`,
      cookies: { boring_session: token },
    })
    expect(nextBRes.statusCode).toBe(200)
    expect(JSON.parse(nextBRes.payload).command).toBeNull()

    await app.close()
  })

  it('returns 401 without auth', async () => {
    const app = getApp()
    const res = await app.inject({ method: 'GET', url: '/api/v1/ui/state' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
