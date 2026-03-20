/**
 * Shared tool renderer mapping for PI and Claude chat providers.
 *
 * Both ClaudeStreamChat and PiBackendAdapter use this single mapping
 * so tool cards render consistently regardless of which agent produced them.
 *
 * Input part shape (normalized):
 *   { name, input, output, error, status, lineCount }
 *
 * For PI backend, `exec_bash` is aliased to `bash`.
 */

import BashToolRenderer from './BashToolRenderer'
import ReadToolRenderer from './ReadToolRenderer'
import WriteToolRenderer from './WriteToolRenderer'
import EditToolRenderer from './EditToolRenderer'
import GlobToolRenderer from './GlobToolRenderer'
import GrepToolRenderer from './GrepToolRenderer'
import ToolUseBlock, { ToolOutput } from './ToolUseBlock'

const parseGrepResults = (output) => {
  if (!output) return []
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)$/)
      if (!match) return { file: 'output', matches: [{ line: 1, content: line }] }
      return {
        file: match[1],
        matches: [{ line: Number(match[2]), content: match[3] }],
      }
    })
}

const parseGlobFiles = (output) => {
  if (!output) return []
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Map from canonical tool name to renderer.
 * Names are matched case-insensitively.
 */
const TOOL_NAME_ALIASES = {
  exec_bash: 'bash',
}

function normalizeToolName(name) {
  const lower = (name || '').toLowerCase()
  return TOOL_NAME_ALIASES[lower] || lower
}

/**
 * Render a tool part into the appropriate tool card component.
 *
 * @param {{ name: string, input?: object, output?: string, error?: string, status?: string, lineCount?: number }} part
 * @returns {JSX.Element}
 */
export function renderToolPart(part) {
  const input = part.input || {}
  const output = part.output || ''
  const toolName = normalizeToolName(part.name)

  if (toolName === 'bash') {
    return (
      <BashToolRenderer
        command={input.command || input.cmd}
        description={input.description}
        output={output}
        error={part.error}
        status={part.status}
        compact={true}
      />
    )
  }
  if (toolName === 'read') {
    return (
      <ReadToolRenderer
        filePath={input.path || input.file_path}
        content={null}
        lineCount={part.lineCount || undefined}
        status={part.status}
        hideContent={true}
      />
    )
  }
  if (toolName === 'write') {
    return (
      <WriteToolRenderer
        filePath={input.path || input.file_path}
        content={input.content || output}
        error={part.error}
        status={part.status}
      />
    )
  }
  if (toolName === 'edit') {
    return (
      <EditToolRenderer
        filePath={input.path || input.file_path}
        diff={input.diff || output}
        error={part.error}
        status={part.status}
      />
    )
  }
  if (toolName === 'glob') {
    return (
      <GlobToolRenderer
        pattern={input.pattern || input.glob}
        files={parseGlobFiles(output)}
        status={part.status}
      />
    )
  }
  if (toolName === 'grep') {
    return (
      <GrepToolRenderer
        pattern={input.pattern || input.query}
        path={input.path}
        results={parseGrepResults(output)}
        status={part.status}
      />
    )
  }

  return <ToolFallback name={part.name} input={input} output={output} />
}

function ToolFallback({ name, input, output }) {
  return (
    <ToolUseBlock
      toolName={name}
      description={input ? 'Custom tool input' : undefined}
      status="complete"
      collapsible={Boolean(output || input)}
      defaultExpanded={false}
    >
      {input && (
        <ToolOutput>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(input, null, 2)}
          </pre>
        </ToolOutput>
      )}
      {output && (
        <ToolOutput style={{ marginTop: '8px' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{output}</pre>
        </ToolOutput>
      )}
    </ToolUseBlock>
  )
}

export { parseGrepResults, parseGlobFiles, normalizeToolName }
