/**
 * @vitest-environment jsdom
 *
 * Backend-mode regression tests:
 * 1. Agent session resets on workspace switch
 * 2. CreateWorkspaceModal input is centered
 */
import React from 'react'
import '../setup.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// 1. PiBackendAdapter — workspace switch clears sessions
// ---------------------------------------------------------------------------
describe('PiBackendAdapter workspace switch', () => {
  // Track the workspaceId passed to API calls
  let capturedWorkspaceIds = []
  let capturedFetchCalls = []

  beforeEach(() => {
    capturedWorkspaceIds = []
    capturedFetchCalls = []

    // Set initial location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/w/workspace-aaa/chat',
        search: '',
        assign: vi.fn(),
        replace: vi.fn(),
      },
    })

    // Mock fetch to return sessions
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      const urlStr = String(url)
      capturedFetchCalls.push({ url: urlStr, opts })

      // Extract workspace_id from URL or body
      const wsMatch = urlStr.match(/workspace_id=([^&]+)/)
      if (wsMatch) capturedWorkspaceIds.push(wsMatch[1])
      if (opts?.body) {
        try {
          const body = JSON.parse(opts.body)
          if (body.workspace_id) capturedWorkspaceIds.push(body.workspace_id)
        } catch {}
      }

      // Sessions list
      if (urlStr.includes('/sessions') && (!opts?.method || opts?.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessions: [] }),
          text: async () => JSON.stringify({ sessions: [] }),
        }
      }

      // Create session
      if (urlStr.includes('/sessions') && opts?.method === 'POST') {
        const id = `sess-${Math.random().toString(36).slice(2, 8)}`
        return {
          ok: true,
          status: 200,
          json: async () => ({
            session: { id, title: 'New', lastModified: new Date().toISOString() },
          }),
          text: async () => JSON.stringify({
            session: { id, title: 'New', lastModified: new Date().toISOString() },
          }),
        }
      }

      // History
      if (urlStr.includes('/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [] }),
          text: async () => JSON.stringify({ messages: [] }),
        }
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      }
    }))
  })

  it('uses the correct workspace ID from URL pathname', async () => {
    const PiBackendAdapter = (await import('../../providers/pi/backendAdapter')).default

    await act(async () => {
      render(
        <PiBackendAdapter
          serviceUrl="/api/pi"
          panelId="test-panel"
          sessionBootstrap="latest"
        />,
      )
    })

    // Wait for initial session load
    await waitFor(() => {
      expect(capturedFetchCalls.length).toBeGreaterThan(0)
    })

    // The workspace ID should be extracted from /w/workspace-aaa/chat
    const sessionsCall = capturedFetchCalls.find((c) => c.url.includes('/sessions'))
    expect(sessionsCall).toBeDefined()
    expect(sessionsCall.url).toContain('workspace-aaa')
  })

  it('resets sessions when workspace changes via popstate', async () => {
    const PiBackendAdapter = (await import('../../providers/pi/backendAdapter')).default

    const { container } = await act(async () =>
      render(
        <PiBackendAdapter
          serviceUrl="/api/pi"
          panelId="test-panel-2"
          sessionBootstrap="latest"
        />,
      ),
    )

    // Wait for initial load
    await waitFor(() => {
      expect(capturedFetchCalls.length).toBeGreaterThan(0)
    })

    const initialCallCount = capturedFetchCalls.length
    capturedWorkspaceIds.length = 0

    // Simulate workspace switch via URL change
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/w/workspace-bbb/chat',
        search: '',
        assign: vi.fn(),
        replace: vi.fn(),
      },
    })

    await act(async () => {
      window.dispatchEvent(new Event('popstate'))
      // Small delay for state updates
      await new Promise((r) => setTimeout(r, 50))
    })

    // After workspace switch, the adapter should make new API calls with workspace-bbb
    await waitFor(() => {
      const postSwitchCalls = capturedFetchCalls.slice(initialCallCount)
      const hasNewWorkspace = postSwitchCalls.some((c) => c.url.includes('workspace-bbb'))
      expect(hasNewWorkspace).toBe(true)
    }, { timeout: 3000 })
  })

  it('resets sessions when workspace changes via boring-ui:location-change', async () => {
    const PiBackendAdapter = (await import('../../providers/pi/backendAdapter')).default

    await act(async () => {
      render(
        <PiBackendAdapter
          serviceUrl="/api/pi"
          panelId="test-panel-3"
          sessionBootstrap="latest"
        />,
      )
    })

    await waitFor(() => {
      expect(capturedFetchCalls.length).toBeGreaterThan(0)
    })

    const initialCallCount = capturedFetchCalls.length

    // Simulate programmatic navigation (pushState)
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        pathname: '/w/workspace-ccc/chat',
        search: '',
        assign: vi.fn(),
        replace: vi.fn(),
      },
    })

    await act(async () => {
      window.dispatchEvent(new Event('boring-ui:location-change'))
      await new Promise((r) => setTimeout(r, 50))
    })

    await waitFor(() => {
      const postSwitchCalls = capturedFetchCalls.slice(initialCallCount)
      const hasNewWorkspace = postSwitchCalls.some((c) => c.url.includes('workspace-ccc'))
      expect(hasNewWorkspace).toBe(true)
    }, { timeout: 3000 })
  })
})

// ---------------------------------------------------------------------------
// 2. CreateWorkspaceModal — title is centered
// ---------------------------------------------------------------------------
describe('CreateWorkspaceModal centering', () => {
  it('.modal-header uses justify-content: center', () => {
    const cssPath = resolve(__dirname, '../../styles.css')
    const css = readFileSync(cssPath, 'utf-8')

    // Extract the .modal-header rule
    const headerMatch = css.match(/\.modal-header\s*\{([^}]+)\}/)
    expect(headerMatch).not.toBeNull()
    const headerRule = headerMatch[1]

    // Should have centered content, not space-between
    expect(headerRule).toContain('justify-content: center')
    expect(headerRule).not.toContain('justify-content: space-between')
  })

  it('.modal-body uses flex-direction: column for proper input layout', () => {
    const cssPath = resolve(__dirname, '../../styles.css')
    const css = readFileSync(cssPath, 'utf-8')

    const bodyMatch = css.match(/\.modal-body\s*\{([^}]+)\}/)
    expect(bodyMatch).not.toBeNull()
    const bodyRule = bodyMatch[1]

    // flex-column ensures label and input stack vertically and stretch full width
    expect(bodyRule).toContain('flex-direction: column')
    expect(bodyRule).toContain('display: flex')
  })

  it('scaleIn animation preserves translate(-50%, -50%) centering', () => {
    const cssPath = resolve(__dirname, '../../styles.css')
    const css = readFileSync(cssPath, 'utf-8')

    // The scaleIn animation must include translate(-50%, -50%) in both from/to,
    // otherwise it overrides Tailwind's centering transforms and the dialog
    // jumps to bottom-left after the animation completes.
    const scaleInMatch = css.match(/@keyframes scaleIn\s*\{([^}]*\{[^}]*\}[^}]*\{[^}]*\})\s*\}/)
    expect(scaleInMatch).not.toBeNull()
    const keyframes = scaleInMatch[1]

    expect(keyframes).toContain('translate(-50%, -50%) scale(0.95)')
    expect(keyframes).toContain('translate(-50%, -50%) scale(1)')
  })
})
