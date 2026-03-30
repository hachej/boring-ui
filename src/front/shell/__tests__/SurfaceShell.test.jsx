import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SurfaceShell from '../SurfaceShell'

const mockArtifacts = [
  { id: 'art-1', title: 'Revenue Chart', kind: 'chart', canonicalKey: 'chart:revenue' },
  { id: 'art-2', title: 'Data Table', kind: 'table', canonicalKey: 'table:data' },
]

describe('SurfaceShell', () => {
  it('when open=false, has display:none style', () => {
    render(
      <SurfaceShell
        open={false}
        collapsed={false}
        artifacts={[]}
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={vi.fn()}
        onCloseArtifact={vi.fn()}
      />
    )
    const surface = screen.getByTestId('surface-shell')
    expect(surface).toHaveStyle({ display: 'none' })
  })

  it('when open=true, is visible', () => {
    render(
      <SurfaceShell
        open={true}
        collapsed={false}
        artifacts={[]}
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={vi.fn()}
        onCloseArtifact={vi.fn()}
      />
    )
    const surface = screen.getByTestId('surface-shell')
    expect(surface).toHaveStyle({ display: 'flex' })
  })

  it('when collapsed=true, shows handle with artifact count', () => {
    render(
      <SurfaceShell
        open={true}
        collapsed={true}
        artifacts={mockArtifacts}
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={vi.fn()}
        onCloseArtifact={vi.fn()}
      />
    )
    const handle = screen.getByTestId('surface-shell-handle')
    expect(handle).toBeInTheDocument()
    const count = screen.getByTestId('surface-handle-count')
    expect(count).toHaveTextContent('2')
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(
      <SurfaceShell
        open={true}
        collapsed={false}
        artifacts={mockArtifacts}
        activeArtifactId="art-1"
        onClose={onClose}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={vi.fn()}
        onCloseArtifact={vi.fn()}
      />
    )
    const closeBtn = screen.getByTestId('surface-close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('renders tab for each artifact in the list', () => {
    render(
      <SurfaceShell
        open={true}
        collapsed={false}
        artifacts={mockArtifacts}
        activeArtifactId="art-1"
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={vi.fn()}
        onCloseArtifact={vi.fn()}
      />
    )
    const tab1 = screen.getByTestId('surface-tab-art-1')
    const tab2 = screen.getByTestId('surface-tab-art-2')
    expect(tab1).toBeInTheDocument()
    expect(tab2).toBeInTheDocument()
    expect(tab1).toHaveTextContent('Revenue Chart')
    expect(tab2).toHaveTextContent('Data Table')
  })

  it('clicking a tab calls onSelectArtifact', () => {
    const onSelect = vi.fn()
    render(
      <SurfaceShell
        open={true}
        collapsed={false}
        artifacts={mockArtifacts}
        activeArtifactId="art-1"
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onResize={vi.fn()}
        onSelectArtifact={onSelect}
        onCloseArtifact={vi.fn()}
      />
    )
    const tab2 = screen.getByTestId('surface-tab-art-2')
    fireEvent.click(tab2)
    expect(onSelect).toHaveBeenCalledWith('art-2')
  })
})
