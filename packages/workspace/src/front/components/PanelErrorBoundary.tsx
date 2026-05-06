import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button, ErrorState } from "@hachej/boring-ui-kit"

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
        <div className="flex h-full items-center justify-center p-6">
          <ErrorState
            className="w-full max-w-md"
            title="Something went wrong"
            description={
              <>
                Panel <code className="rounded bg-muted px-1 py-0.5 text-xs">{this.props.panelId}</code>{" "}
                encountered an error.
              </>
            }
            details={this.state.error?.message}
            actions={
              <Button type="button" variant="outline" onClick={this.handleRetry}>
                Retry
              </Button>
            }
          />
        </div>
      )
    }

    return this.props.children
  }
}
