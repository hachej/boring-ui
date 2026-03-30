import React from 'react'
import {
  Loader2,
  Check,
  X,
  FileCode,
  Terminal,
  Search,
  FolderTree,
  GitBranch,
  Pencil,
  Eye,
  Wrench,
} from 'lucide-react'

/**
 * Icon registry mapping tool names to appropriate icons.
 * Falls back to Wrench for unknown tools.
 */
const TOOL_ICONS = {
  read_file: Eye,
  write_file: FileCode,
  edit_file: Pencil,
  bash: Terminal,
  grep: Search,
  find: Search,
  ls: FolderTree,
  git_diff: GitBranch,
  git_status: GitBranch,
  git_commit: GitBranch,
}

function getToolIcon(toolName) {
  // Try exact match, then prefix match
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName]
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (toolName.startsWith(key)) return Icon
  }
  return Wrench
}

/**
 * Extract a displayable file path from tool args.
 */
function getFilePath(args) {
  if (!args) return null
  return args.path || args.file_path || args.filepath || null
}

/**
 * ToolCallCard - Inline card showing a tool execution in the chat timeline.
 *
 * Props:
 *   toolName   - string, name of the tool being called
 *   args       - object, tool arguments (may contain path/file_path)
 *   result     - string|object, tool result (optional)
 *   status     - 'running' | 'complete' | 'error'
 */
export default function ToolCallCard({ toolName, args, result, status }) {
  const ToolIcon = getToolIcon(toolName)
  const filePath = getFilePath(args)

  return (
    <div className="vc-tool-card" data-status={status}>
      <div className="vc-tool-card-icon">
        <ToolIcon size={14} />
      </div>
      <div className="vc-tool-card-info">
        <span className="vc-tool-card-name">{toolName}</span>
        {filePath && (
          <span className="vc-tool-card-path">{filePath}</span>
        )}
      </div>
      <div className="vc-tool-card-status">
        {status === 'running' && (
          <span data-testid="tool-status-running">
            <Loader2 size={14} className="vc-tool-spinner" />
          </span>
        )}
        {status === 'complete' && (
          <span data-testid="tool-status-complete">
            <Check size={14} className="vc-tool-check" />
          </span>
        )}
        {status === 'error' && (
          <span data-testid="tool-status-error">
            <X size={14} className="vc-tool-error" />
          </span>
        )}
      </div>
    </div>
  )
}
