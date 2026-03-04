import { describe, expect, it, vi } from 'vitest'
import {
  publishPiSessionState,
  requestPiNewSession,
  requestPiSessionState,
  requestPiSwitchSession,
  subscribePiSessionActions,
  subscribePiSessionState,
} from './sessionBus'

describe('pi sessionBus', () => {
  it('scopes session state by panel id', () => {
    const aListener = vi.fn()
    const bListener = vi.fn()
    const unsubscribeA = subscribePiSessionState('pi-a', aListener)
    const unsubscribeB = subscribePiSessionState('pi-b', bListener)

    publishPiSessionState('pi-a', {
      currentSessionId: 'a-1',
      sessions: [{ id: 'a-1', title: 'A' }],
    })
    publishPiSessionState('pi-b', {
      currentSessionId: 'b-1',
      sessions: [{ id: 'b-1', title: 'B' }],
    })

    expect(aListener).toHaveBeenCalledTimes(1)
    expect(aListener).toHaveBeenCalledWith({
      currentSessionId: 'a-1',
      sessions: [{ id: 'a-1', title: 'A' }],
    })
    expect(bListener).toHaveBeenCalledTimes(1)
    expect(bListener).toHaveBeenCalledWith({
      currentSessionId: 'b-1',
      sessions: [{ id: 'b-1', title: 'B' }],
    })

    unsubscribeA()
    unsubscribeB()
  })

  it('scopes switch/new/request actions by panel id', () => {
    const onSwitch = vi.fn()
    const onNew = vi.fn()
    const onRequestState = vi.fn()
    const unsubscribe = subscribePiSessionActions('pi-a', {
      onSwitch,
      onNew,
      onRequestState,
    })

    requestPiSwitchSession('pi-b', 'b-1')
    requestPiNewSession('pi-b')
    requestPiSessionState('pi-b')

    expect(onSwitch).not.toHaveBeenCalled()
    expect(onNew).not.toHaveBeenCalled()
    expect(onRequestState).not.toHaveBeenCalled()

    requestPiSwitchSession('pi-a', 'a-1')
    requestPiNewSession('pi-a')
    requestPiSessionState('pi-a')

    expect(onSwitch).toHaveBeenCalledTimes(1)
    expect(onSwitch).toHaveBeenCalledWith('a-1')
    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onRequestState).toHaveBeenCalledTimes(1)

    unsubscribe()
  })
})
