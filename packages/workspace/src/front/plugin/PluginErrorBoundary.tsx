import { Component, type ReactNode, type ErrorInfo } from "react"
import { ErrorChip } from "../components/ErrorChip"
import { PluginErrorContext, type PluginError } from "./PluginErrorContext"

interface Props {
  pluginId: string
  contributionKind: "panel" | "catalog-row" | "chat-suggestion"
  contributionId?: string
  children?: ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class PluginErrorBoundary extends Component<Props, State> {
  static contextType = PluginErrorContext
  declare context: React.ContextType<typeof PluginErrorContext>

  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const pluginError: PluginError = {
      kind: "contribution",
      pluginId: this.props.pluginId,
      contributionKind: this.props.contributionKind,
      contributionId: this.props.contributionId,
      error,
      componentStack: info.componentStack
        ? truncateStack(info.componentStack, 5)
        : null,
    }
    this.context?.reportPluginError(pluginError)
    this.props.onError?.(error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-boring-plugin-error-boundary="true"
          data-boring-plugin-id={this.props.pluginId}
          data-boring-contribution-kind={this.props.contributionKind}
          data-boring-contribution-id={this.props.contributionId}
        >
          <ErrorChip
            pluginId={this.props.pluginId}
            message={this.state.error.message}
            kind={this.props.contributionKind}
          />
        </div>
      )
    }
    return this.props.children
  }
}

function truncateStack(stack: string, maxFrames: number): string {
  const lines = stack.split("\n").filter((l) => l.trim())
  return lines.slice(0, maxFrames).join("\n")
}
