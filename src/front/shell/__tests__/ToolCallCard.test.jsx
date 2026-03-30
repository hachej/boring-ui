import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ToolCallCard from '../ToolCallCard'

describe('ToolCallCard', () => {
  it('shows Loader spinner when status is running', () => {
    render(<ToolCallCard toolName="read_file" args={{}} status="running" />)
    const spinner = screen.getByTestId('tool-status-running')
    expect(spinner).toBeInTheDocument()
  })

  it('shows Check icon when status is complete', () => {
    render(
      <ToolCallCard
        toolName="read_file"
        args={{}}
        status="complete"
        result="file contents"
      />
    )
    const check = screen.getByTestId('tool-status-complete')
    expect(check).toBeInTheDocument()
  })

  it('shows X icon when status is error', () => {
    render(
      <ToolCallCard
        toolName="read_file"
        args={{}}
        status="error"
        result="Error: file not found"
      />
    )
    const errorIcon = screen.getByTestId('tool-status-error')
    expect(errorIcon).toBeInTheDocument()
  })

  it('displays tool name', () => {
    render(<ToolCallCard toolName="bash" args={{}} status="running" />)
    expect(screen.getByText('bash')).toBeInTheDocument()
  })

  it('displays file path from args when present', () => {
    render(
      <ToolCallCard
        toolName="read_file"
        args={{ path: '/src/components/App.jsx' }}
        status="complete"
        result="contents"
      />
    )
    expect(screen.getByText('/src/components/App.jsx')).toBeInTheDocument()
  })
})
