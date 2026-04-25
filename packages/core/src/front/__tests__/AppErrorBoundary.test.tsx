// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppErrorBoundary } from '../AppErrorBoundary'
import { ConfigFetchError } from '../../shared/errors'

function ThrowingChild({ error }: { error: Error }): never {
  throw error
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('AppErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <AppErrorBoundary>
        <p>all good</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeDefined()
  })

  it('catches thrown error and renders fallback', () => {
    render(
      <AppErrorBoundary>
        <ThrowingChild error={new Error('Boom')} />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeDefined()
    expect(screen.getByText('Boom')).toBeDefined()
    expect(screen.getByText('Reload page')).toBeDefined()
  })

  it('calls onError when an error is caught', () => {
    const onError = vi.fn()
    render(
      <AppErrorBoundary onError={onError}>
        <ThrowingChild error={new Error('Kaboom')} />
      </AppErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(onError.mock.calls[0][0].message).toBe('Kaboom')
  })

  it('renders ConfigFetchError-specific UI with retry', () => {
    const error = new ConfigFetchError('Server unreachable', 'req-abc-123')
    render(
      <AppErrorBoundary>
        <ThrowingChild error={error} />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Cannot reach server')).toBeDefined()
    expect(screen.getByText('Server unreachable')).toBeDefined()
    expect(screen.getByText('Request ID: req-abc-123')).toBeDefined()
    expect(screen.getByText('Retry')).toBeDefined()
  })

  it('retry button re-mounts children (clears error state)', () => {
    let shouldThrow = true

    function MaybeThrow() {
      if (shouldThrow) {
        throw new ConfigFetchError('First failure')
      }
      return <p>recovered</p>
    }

    render(
      <AppErrorBoundary>
        <MaybeThrow />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Cannot reach server')).toBeDefined()

    shouldThrow = false
    fireEvent.click(screen.getByText('Retry'))

    expect(screen.getByText('recovered')).toBeDefined()
  })

  it('does not show request ID when not provided', () => {
    const error = new ConfigFetchError('Server down')
    render(
      <AppErrorBoundary>
        <ThrowingChild error={error} />
      </AppErrorBoundary>,
    )

    expect(screen.getByText('Cannot reach server')).toBeDefined()
    expect(screen.queryByText(/Request ID/)).toBeNull()
  })
})
