// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ArtifactOpenProvider, useOpenArtifact } from '../ArtifactOpenContext'

function Probe() {
  const onOpenArtifact = useOpenArtifact()
  return (
    <button type="button" onClick={() => onOpenArtifact?.('src/file.ts')}>
      {onOpenArtifact ? 'open' : 'none'}
    </button>
  )
}

describe('ArtifactOpenProvider', () => {
  test('inherits the outer artifact opener when no inner handler is provided', () => {
    const outerOpen = vi.fn()

    render(
      <ArtifactOpenProvider onOpenArtifact={outerOpen}>
        <ArtifactOpenProvider>
          <Probe />
        </ArtifactOpenProvider>
      </ArtifactOpenProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'open' }))

    expect(outerOpen).toHaveBeenCalledWith('src/file.ts')
  })
})
