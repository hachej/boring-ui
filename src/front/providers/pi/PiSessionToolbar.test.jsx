import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import PiSessionToolbar from './PiSessionToolbar'

const requestPiNewSession = vi.fn()
const requestPiSessionState = vi.fn()
const requestPiSwitchSession = vi.fn()
let stateListener = null

vi.mock('./sessionBus', () => ({
  requestPiNewSession: (...args) => requestPiNewSession(...args),
  requestPiSessionState: (...args) => requestPiSessionState(...args),
  requestPiSwitchSession: (...args) => requestPiSwitchSession(...args),
  subscribePiSessionState: (_panelId, listener) => {
    stateListener = listener
    return () => {
      stateListener = null
    }
  },
}))

describe('PiSessionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stateListener = null
  })

  it('requests state on mount', () => {
    render(<PiSessionToolbar panelId="pi-agent" />)
    expect(requestPiSessionState).toHaveBeenCalledTimes(1)
    expect(requestPiSessionState).toHaveBeenCalledWith('pi-agent')
  })

  it('splits panel on + click when split handler is provided', () => {
    const onSplitPanel = vi.fn()
    render(<PiSessionToolbar panelId="pi-agent" onSplitPanel={onSplitPanel} />)

    fireEvent.click(screen.getByTestId('pi-session-new'))

    expect(onSplitPanel).toHaveBeenCalledWith('pi-agent', { piSessionBootstrap: 'new' })
    expect(requestPiNewSession).not.toHaveBeenCalled()
  })

  it('creates a new PI session on + click when split handler is unavailable', () => {
    render(<PiSessionToolbar panelId="pi-agent" />)

    fireEvent.click(screen.getByTestId('pi-session-new'))

    expect(requestPiNewSession).toHaveBeenCalledWith('pi-agent')
  })

  it('renders sessions and switches by id', () => {
    render(<PiSessionToolbar panelId="pi-agent" />)
    act(() => {
      stateListener?.({
        currentSessionId: 's-1',
        sessions: [
          { id: 's-1', title: 'Session 1' },
          { id: 's-2', title: 'Session 2' },
        ],
      })
    })

    fireEvent.change(screen.getByTestId('pi-session-select'), { target: { value: 's-2' } })
    expect(requestPiSwitchSession).toHaveBeenCalledWith('pi-agent', 's-2')
  })
})
