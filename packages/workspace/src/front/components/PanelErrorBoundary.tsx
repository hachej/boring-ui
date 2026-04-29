import { Component, type ErrorInfo, type ReactNode } from "react"

export interface PanelErrorBoundaryProps {
  panelId: string
  onError?: (data: { panelId: string; error: string; stack?: string }) => void
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { panelId, onError } = this.props
    console.error(`[PanelErrorBoundary] Panel "${panelId}" crashed:`, error, info.componentStack)
    onError?.({
      panelId,
      error: error.message,
      stack: info.componentStack ?? undefined,
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="text-destructive text-lg font-medium">Something went wrong</div>
          <p className="text-muted-foreground text-sm">
            Panel <code className="rounded bg-muted px-1 py-0.5 text-xs">{this.props.panelId}</code> encountered an error.
          </p>
          {this.state.error && (
            <pre className="max-w-md overflow-auto rounded border border-border bg-muted p-3 text-xs text-muted-foreground">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
