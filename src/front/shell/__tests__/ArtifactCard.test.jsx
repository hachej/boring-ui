import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ArtifactCard from '../ArtifactCard'

const mockArtifact = {
  title: 'Revenue Chart',
  kind: 'chart',
  icon: 'BarChart3',
}

describe('ArtifactCard', () => {
  it('default state: subtle border, no accent', () => {
    render(<ArtifactCard artifact={mockArtifact} state="default" />)
    const card = screen.getByTestId('artifact-card')
    expect(card).toBeInTheDocument()
    expect(card).not.toHaveClass('active')
    expect(card).not.toHaveClass('open')
  })

  it('open state: elevated border', () => {
    render(<ArtifactCard artifact={mockArtifact} state="open" />)
    const card = screen.getByTestId('artifact-card')
    expect(card).toHaveClass('open')
  })

  it('active state: accent border + glow', () => {
    render(<ArtifactCard artifact={mockArtifact} state="active" />)
    const card = screen.getByTestId('artifact-card')
    expect(card).toHaveClass('active')
  })

  it('click fires onOpen callback with artifact data', () => {
    const onOpen = vi.fn()
    render(
      <ArtifactCard artifact={mockArtifact} state="default" onOpen={onOpen} />
    )
    const card = screen.getByTestId('artifact-card')
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith(mockArtifact)
  })

  it('shows chevron icon', () => {
    render(<ArtifactCard artifact={mockArtifact} state="default" />)
    const chevron = screen.getByTestId('artifact-chevron')
    expect(chevron).toBeInTheDocument()
  })
})
