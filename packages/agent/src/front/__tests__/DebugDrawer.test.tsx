import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('lucide-react', () => {
  const Icon = () => <svg />
  return {
    CheckIcon: Icon,
    ChevronDownIcon: Icon,
    ChevronRightIcon: Icon,
    CopyIcon: Icon,
    RefreshCwIcon: Icon,
  }
})

import { DebugDrawer } from '../DebugDrawer'

describe('DebugDrawer', () => {
  test('shows pi session id and terminal resume command by default', () => {
    const html = renderToStaticMarkup(
      <DebugDrawer
        sessionId="sess-debug-123"
        messages={[]}
        width={440}
        onWidthChange={() => {}}
      />,
    )

    expect(html).toContain('Session')
    expect(html).toContain('Pi session id')
    expect(html).toContain('sess-debug-123')
    expect(html).toContain('pi --session sess-debug-123')
    expect(html).toContain('pi --continue')
  })
})
