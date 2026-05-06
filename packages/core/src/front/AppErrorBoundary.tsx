import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, ErrorState } from '@hachej/boring-ui-kit
import { ConfigFetchError } from '../shared/errors.js'

interface AppErrorBoundaryProps {
  children: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, errorInfo)
    this.props.onError?.(error, errorInfo)
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isConfigError = error instanceof ConfigFetchError

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
        <ErrorState
          className="w-full max-w-lg"
          title={isConfigError ? 'Cannot reach server' : 'Something went wrong'}
          description={error.message}
          details={isConfigError && error.requestId ? `Request ID: ${error.requestId}` : undefined}
          actions={
            <Button type="button" onClick={isConfigError ? this.handleRetry : this.handleReload}>
              {isConfigError ? 'Retry' : 'Reload page'}
            </Button>
          }
        />
      </div>
    )
  }
}
