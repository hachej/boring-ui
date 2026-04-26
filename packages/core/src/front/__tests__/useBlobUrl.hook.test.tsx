// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { withBeadId } from '../../server/__tests__/_setup'
import { useBlobUrl } from '../hooks/useBlobUrl'

const BEAD_ID = 'boring-ui-v2-d37p'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useBlobUrl hook', () => {
  it(
    'creates and revokes blob URLs across change/null/unmount lifecycle',
    withBeadId(BEAD_ID, async ({ assertionPassed }) => {
      let counter = 0
      const createSpy = vi.fn(() => `blob:mock-${counter += 1}`)
      const revokeSpy = vi.fn()

      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: createSpy,
      })
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: revokeSpy,
      })

      const blobA = new Blob(['a'], { type: 'text/plain' })
      const blobB = new Blob(['b'], { type: 'text/plain' })
      const blobC = new Blob(['c'], { type: 'text/plain' })

      const { result, rerender, unmount } = renderHook(
        ({ blob }: { blob: Blob | null }) => useBlobUrl(blob),
        { initialProps: { blob: blobA } as { blob: Blob | null } },
      )

      expect(result.current).toBe('blob:mock-1')
      assertionPassed('useBlobUrl-create')

      rerender({ blob: blobB })
      expect(result.current).toBe('blob:mock-2')
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-1')
      assertionPassed('useBlobUrl-revoke-on-change')

      rerender({ blob: null })
      expect(result.current).toBeNull()
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-2')
      assertionPassed('useBlobUrl-null-clears')

      rerender({ blob: blobC })
      expect(result.current).toBe('blob:mock-3')

      unmount()
      expect(revokeSpy).toHaveBeenCalledWith('blob:mock-3')
      expect(createSpy).toHaveBeenCalledTimes(3)
      assertionPassed('useBlobUrl-revoke-on-unmount')
    }),
  )
})
