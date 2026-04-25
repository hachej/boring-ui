import { Component, type ErrorInfo, type ReactNode } from 'react'
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

    if (error instanceof ConfigFetchError) {
      return (
        <div style={containerStyle}>
          <h1 style={headingStyle}>Cannot reach server</h1>
          <p style={messageStyle}>{error.message}</p>
          {error.requestId && (
            <p style={detailStyle}>Request ID: {error.requestId}</p>
          )}
          <button type="button" style={buttonStyle} onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      )
    }

    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Something went wrong</h1>
        <p style={messageStyle}>{error.message}</p>
        <button type="button" style={buttonStyle} onClick={this.handleReload}>
          Reload page
        </button>
      </div>
    )
  }
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: '2rem',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
}

const headingStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 600,
  color: '#1a1a1a',
  margin: '0 0 0.5rem',
}

const messageStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#525f7f',
  margin: '0 0 1.5rem',
  textAlign: 'center',
  maxWidth: '32rem',
}

const detailStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#8898aa',
  margin: '0 0 1rem',
  fontFamily: 'monospace',
}

const buttonStyle: React.CSSProperties = {
  padding: '0.5rem 1.5rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#ffffff',
  backgroundColor: '#1a1a1a',
  border: 'none',
  borderRadius: '0.375rem',
  cursor: 'pointer',
}
