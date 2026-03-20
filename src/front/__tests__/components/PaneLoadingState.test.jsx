import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaneLoadingState from '../../components/PaneLoadingState'

describe('PaneLoadingState', () => {
  it('renders with pane title', () => {
    render(<PaneLoadingState paneId="editor" paneTitle="Code Editor" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Code Editor Loading')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for backend capabilities/)).toBeInTheDocument()
  })

  it('falls back to paneId when paneTitle is missing', () => {
    render(<PaneLoadingState paneId="editor" />)

    expect(screen.getByText('editor Loading')).toBeInTheDocument()
  })

  it('has accessible status role', () => {
    render(<PaneLoadingState paneId="test" paneTitle="Test" />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveClass('pane-loading-state')
    expect(status).toHaveStyle({
      display: 'flex',
      width: '100%',
      justifyContent: 'center',
      textAlign: 'center',
    })
  })
})
