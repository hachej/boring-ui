import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'

import { useFileChangeStream } from '../useFileChangeStream'

function renderHookWithProvider(queryClient: QueryClient): { onData: (part: unknown) => void } {
  let captured: { onData: (part: unknown) => void } | null = null

  function HookProbe() {
    captured = useFileChangeStream()
    return null
  }

  renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <HookProbe />
    </QueryClientProvider>,
  )

  if (!captured) {
    throw new Error('hook result not captured')
  }
  return captured
}

describe('useFileChangeStream', () => {
  test('invalidates tree and file keys for data-file-changed', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => Promise.resolve())
    const { onData } = renderHookWithProvider(queryClient)

    onData({
      type: 'data-file-changed',
      data: {
        op: 'rename',
        path: 'next.txt',
        oldPath: 'prev.txt',
        toolCallId: 'tool-1',
        timestamp: '2026-04-23T00:00:00.000Z',
      },
    })

    expect(invalidateSpy).toHaveBeenCalledTimes(3)
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: ['tree'] })
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, {
      queryKey: ['file', 'next.txt'],
    })
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, {
      queryKey: ['file', 'prev.txt'],
    })
  })

  test('ignores non file-change data parts', () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => Promise.resolve())
    const { onData } = renderHookWithProvider(queryClient)

    onData({
      type: 'data-status',
      data: { level: 'info', msg: 'noop' },
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  test('no-ops safely when rendered outside a query provider', () => {
    let captured: { onData: (part: unknown) => void } | null = null

    function HookProbe() {
      captured = useFileChangeStream()
      return null
    }

    renderToStaticMarkup(<HookProbe />)
    expect(captured).toBeTruthy()

    expect(() => {
      captured!.onData({
        type: 'data-file-changed',
        data: {
          op: 'write',
          path: 'a.txt',
          toolCallId: 'tool-2',
          timestamp: '2026-04-23T00:00:00.000Z',
        },
      })
    }).not.toThrow()
  })
})

