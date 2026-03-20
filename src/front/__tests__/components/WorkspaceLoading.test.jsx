import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import WorkspaceLoading from '../../components/WorkspaceLoading'

describe('WorkspaceLoading', () => {
  it('renders a centered workspace loading shell with copy', () => {
    render(<WorkspaceLoading title="Opening workspace" message="Connecting to backend services..." />)

    const status = screen.getByRole('status')
    expect(status).toHaveClass('workspace-loading')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveStyle({
      display: 'flex',
      width: '100%',
      justifyContent: 'center',
      textAlign: 'center',
    })
    expect(screen.getByText('Opening workspace')).toBeInTheDocument()
    expect(screen.getByText('Connecting to backend services...')).toBeInTheDocument()
  })
})
