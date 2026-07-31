import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { usePiSessions } from '../usePiSessions'

describe('usePiSessions server rendering', () => {
  test('renders without running browser layout effects', () => {
    const fetchMock = vi.fn()

    function Harness() {
      const sessions = usePiSessions({
        enabled: false,
        fetch: fetchMock as unknown as typeof fetch,
        connectActiveSession: false,
      })
      return <div>{sessions.sessions.length}</div>
    }

    expect(renderToStaticMarkup(<Harness />)).toBe('<div>0</div>')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
