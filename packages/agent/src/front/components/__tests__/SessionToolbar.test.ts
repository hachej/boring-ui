import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { SessionSummary } from '../../../shared/session'
import type { UseSessionsResult } from '../../hooks/useSessions'

function makeSummary(id: string, title: string): SessionSummary {
  return {
    id,
    title,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    turnCount: 0,
  }
}

const mockCreate = vi.fn()
const mockSwitch = vi.fn()
const mockDelete = vi.fn()

let hookResult: UseSessionsResult

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => hookResult,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (init: unknown) => {
      const val = typeof init === 'function' ? (init as () => unknown)() : init
      return [val, vi.fn()]
    },
    useEffect: () => {},
    useRef: (v: unknown) => ({ current: v }),
  }
})

import { SessionToolbar } from '../SessionToolbar'

function resetHook() {
  hookResult = {
    sessions: [],
    activeSession: undefined,
    activeSessionId: undefined,
    loading: false,
    error: undefined,
    create: mockCreate,
    switch: mockSwitch,
    delete: mockDelete,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetHook()
})

describe('SessionToolbar', () => {
  test('renders with session-toolbar class', () => {
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    expect(result).toBeDefined()
    expect(result.props.className).toBe('session-toolbar')
  })

  test('shows current session title from sessions list', () => {
    hookResult.sessions = [makeSummary('s1', 'My Chat')]
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const trigger = result.props.children[0]
    const titleSpan = trigger.props.children[0]
    expect(titleSpan.props.children).toBe('My Chat')
  })

  test('shows fallback when session not found', () => {
    hookResult.sessions = []
    const result = SessionToolbar({ sessionId: 'missing', onSessionChange: vi.fn() })
    const trigger = result.props.children[0]
    const titleSpan = trigger.props.children[0]
    expect(titleSpan.props.children).toBe('New session')
  })

  test('shows loading indicator', () => {
    hookResult.loading = true
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const trigger = result.props.children[0]
    const titleSpan = trigger.props.children[0]
    expect(titleSpan.props.children).toBe('…')
  })

  test('trigger has correct aria attributes', () => {
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const trigger = result.props.children[0]
    expect(trigger.props['aria-expanded']).toBe(false)
    expect(trigger.props['aria-haspopup']).toBe('listbox')
  })

  test('dropdown is not rendered when closed', () => {
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const children = result.props.children
    const dropdown = children[children.length - 1]
    expect(dropdown).toBeFalsy()
  })

  test('surfaces hook error in alert element', () => {
    hookResult.error = new Error('Network fail')
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const errorEl = result.props.children[1]
    expect(errorEl).toBeTruthy()
    expect(errorEl.props.role).toBe('alert')
    expect(errorEl.props.children).toBe('Network fail')
  })

  test('no error element when hook has no error', () => {
    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const errorEl = result.props.children[1]
    expect(errorEl).toBeFalsy()
  })

  test('session items are rendered as buttons for keyboard access', () => {
    hookResult.sessions = [makeSummary('s1', 'Chat')]
    hookResult.loading = false

    const result = SessionToolbar({ sessionId: 's1', onSessionChange: vi.fn() })
    const trigger = result.props.children[0]
    expect(trigger.type).toBe('button')
  })
})
