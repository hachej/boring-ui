import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatPart } from '../../../../shared/chat'
import { ErrorCode } from '../../../../shared/error-codes'
import type { ToolPart } from '../../../bareToolRenderers'

vi.mock('@hachej/boring-ui-kit', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>,
  Collapsible: ({ children, ...props }: { children: React.ReactNode }) => <div data-testid="collapsible" {...props}>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div data-testid="content">{children}</div>,
  CollapsibleTrigger: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>,
}))

import { ToolCallGroup } from '../../../primitives/tool-call-group'

function toolPart(overrides: Partial<Extract<BoringChatPart, { type: 'tool-call' }>> = {}): Extract<BoringChatPart, { type: 'tool-call' }> {
  return {
    type: 'tool-call',
    id: 'call-1',
    toolName: 'custom_tool',
    state: 'output-available',
    input: { task: 'demo' },
    output: { content: [{ type: 'text', text: 'ok' }] },
    ...overrides,
  }
}

describe('ToolCallGroup Pi-native adapter', () => {
  test('routes BoringChatPart by output.details.ui.rendererId before toolName', () => {
    const rendererById = vi.fn((part: ToolPart) => <div>renderer-id:{part.toolCallId}:{part.toolName}:{String((part.ui?.details as { mode?: string })?.mode)}</div>)
    const rendererByToolName = vi.fn(() => <div>tool-name</div>)
    const part = toolPart({
      id: 'pi-tool-call-1',
      toolName: 'custom_tool',
      output: {
        details: {
          ui: {
            rendererId: 'plugin-card',
            displayGroup: 'plugin tools',
            icon: 'sparkles',
            details: { mode: 'special' },
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[{ part, key: part.id }]}
        mergedToolRenderers={{ 'plugin-card': rendererById, custom_tool: rendererByToolName }}
      />,
    )

    expect(rendererById).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tool-call',
      toolCallId: 'pi-tool-call-1',
      toolName: 'custom_tool',
      ui: expect.objectContaining({ rendererId: 'plugin-card', displayGroup: 'plugin tools', icon: 'sparkles' }),
      rendererResolution: { key: 'plugin-card', source: 'rendererId', requestedRendererId: 'plugin-card' },
    }))
    expect(rendererByToolName).not.toHaveBeenCalled()
    expect(html).toContain('renderer-id:pi-tool-call-1:custom_tool:special')
    expect(html).toContain('aria-label="Tool calls: Used custom_tool"')
    expect(html).toContain('data-boring-agent-tool-state="settled"')
    expect(html).not.toContain('Running 0s')
    expect(html).toContain('motion-reduce:transition-none')
    expect(html).toContain('data-tool-renderer-source="rendererId"')
  })

  test('falls back to toolName when rendererId metadata is malformed', () => {
    const rendererByToolName = vi.fn((part: ToolPart) => <div>tool-name:{part.toolName}:ui={String(Boolean(part.ui))}</div>)
    const part = toolPart({
      output: { details: { ui: { rendererId: 123, details: { ignored: true } } } },
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[{ part, key: part.id }]}
        mergedToolRenderers={{ custom_tool: rendererByToolName }}
      />,
    )

    expect(rendererByToolName).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'custom_tool',
      ui: undefined,
      rendererResolution: { key: 'custom_tool', source: 'toolName', requestedRendererId: undefined },
    }))
    expect(html).toContain('tool-name:custom_tool:ui=false')
  })

  test('uses safe fallback visibly when rendererId and toolName are unknown', () => {
    const part = toolPart({
      toolName: 'future_tool',
      output: { details: { ui: { rendererId: 'future-card' } } },
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part, key: part.id }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('future_tool')
    expect(html).toContain('renderer future-card unavailable')
    expect(html).toContain('data-tool-renderer-key="__fallback"')
    expect(html).toContain('data-tool-renderer-source="fallback"')
  })

  test('announces failed tool groups distinctly from successful used tools', () => {
    const part = toolPart({
      id: 'bash-failed-1',
      toolName: 'bash',
      state: 'output-error',
      input: { command: 'false' },
      output: { stderr: 'command failed' },
      errorText: 'command failed',
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part, key: part.id }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('aria-label="Tool calls: Failed command"')
    expect(html).toContain('Failed command')
    expect(html).toContain('data-boring-agent-tool-state="failed"')
    expect(html).toContain('data-boring-agent-part="tool-group-state-dot"')
    expect(html).toContain('bg-destructive')
    expect(html).toContain('ring-destructive/20')
    expect(html).not.toContain('Tool calls: Used command')
    expect(html).not.toContain('Running 0s')
    expect(html).not.toContain('border-destructive/30')
    expect(html).not.toContain('text-destructive/60')
  })

  test('announces aborted tool groups distinctly from successful used tools', () => {
    const part = toolPart({
      id: 'bash-aborted-1',
      toolName: 'bash',
      state: 'aborted',
      input: { command: 'sleep 10' },
      output: undefined,
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part, key: part.id }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('aria-label="Tool calls: Stopped command"')
    expect(html).toContain('Stopped command')
    expect(html).toContain('data-boring-agent-tool-state="aborted"')
    expect(html).not.toContain('Tool calls: Used command')
    expect(html).not.toContain('data-boring-agent-tool-state="settled"')
    expect(html).not.toContain('Running 0s')
  })

  test('shows elapsed running status for live tool groups', () => {
    const part = toolPart({
      id: 'bash-running-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'sleep 10' },
      output: undefined,
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part, key: part.id }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('aria-label="Tool calls: Using command"')
    expect(html).toContain('Using command')
    expect(html).toContain('data-boring-agent-tool-state="running"')
    expect(html).toContain('Running 0s')
    expect(html).not.toContain('Tool calls: Used command')
  })

  test('summarizes repeated and distinct tool names in a stable title', () => {
    const firstBash = toolPart({ id: 'bash-used-1', toolName: 'bash' })
    const secondBash = toolPart({ id: 'bash-used-2', toolName: 'bash' })
    const read = toolPart({ id: 'read-used-1', toolName: 'read' })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[
          { part: firstBash, key: firstBash.id },
          { part: secondBash, key: secondBash.id },
          { part: read, key: read.id },
        ]}
        mergedToolRenderers={{}}
      />,
    )

    expect(html).toContain('aria-label="Tool calls: Used command ×2 · read"')
    expect(html).toContain('Used command ×2 · read')
  })

  test('does not show elapsed running status while workspace is not ready', () => {
    const part = toolPart({
      id: 'bash-workspace-not-ready-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'pwd' },
      output: {
        details: {
          code: ErrorCode.enum.WORKSPACE_NOT_READY,
          retryable: true,
          requirement: 'workspace-fs',
        },
      },
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part, key: part.id }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('aria-label="Tool calls: Waiting for command"')
    expect(html).toContain('data-boring-agent-tool-state="workspace-not-ready"')
    expect(html).toContain('Files are still loading.')
    expect(html).not.toContain('Running 0s')
  })

  test('marks mixed groups running when any sibling tool is still genuinely running', () => {
    const workspaceNotReadyPart = toolPart({
      id: 'bash-workspace-not-ready-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'pwd' },
      output: {
        details: {
          code: ErrorCode.enum.WORKSPACE_NOT_READY,
          retryable: true,
          requirement: 'workspace-fs',
        },
      },
    })
    const runningPart = toolPart({
      id: 'bash-running-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'sleep 10' },
      output: undefined,
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[
          { part: workspaceNotReadyPart, key: workspaceNotReadyPart.id },
          { part: runningPart, key: runningPart.id },
        ]}
        mergedToolRenderers={{}}
      />,
    )

    expect(html).toContain('data-boring-agent-tool-state="running"')
    expect(html).toContain('Files are still loading.')
    expect(html).toContain('Running 0s')
  })

  test('keeps mixed running and failed groups visually running', () => {
    const failedPart = toolPart({
      id: 'bash-failed-1',
      toolName: 'bash',
      state: 'output-error',
      input: { command: 'false' },
      output: { stderr: 'command failed' },
      errorText: 'command failed',
    })
    const runningPart = toolPart({
      id: 'bash-running-1',
      toolName: 'bash',
      state: 'input-available',
      input: { command: 'sleep 10' },
      output: undefined,
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[
          { part: failedPart, key: failedPart.id },
          { part: runningPart, key: runningPart.id },
        ]}
        mergedToolRenderers={{}}
      />,
    )

    expect(html).toContain('data-boring-agent-tool-state="running"')
    expect(html).toContain('Running 0s')
    expect(html).not.toContain('border-destructive/30')
  })
})
