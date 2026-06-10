import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { ToolPart } from '../../bareToolRenderers'

vi.mock('@hachej/boring-ui-kit', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>,
  Collapsible: ({ children, ...props }: { children: React.ReactNode }) => <div data-testid="collapsible" {...props}>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div data-testid="content">{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}))

import { ToolCallGroup } from '../tool-call-group'

function toolPart(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    type: 'tool-custom_tool',
    toolName: 'custom_tool',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { task: 'demo' },
    output: { content: [{ type: 'text', text: 'ok' }] },
    ...overrides,
  }
}

describe('ToolCallGroup renderer metadata', () => {
  test('marks approval-requested groups separately from running groups', () => {
    const part = toolPart({
      state: 'approval-requested',
      output: undefined,
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part: part as any, key: 'call-1' }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('data-boring-agent-tool-state="approval-needed"')
    expect(html).toContain('Needs approval custom_tool')
    expect(html).not.toContain('data-boring-agent-tool-state="running"')
    expect(html).not.toContain('Running 0s')
  })

  test.each(['output-denied', 'approval-responded'] as const)('marks %s groups settled', (state) => {
    const part = toolPart({ state })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part: part as any, key: 'call-1' }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('data-boring-agent-tool-state="settled"')
    expect(html).not.toContain('data-boring-agent-tool-state="running"')
    expect(html).not.toContain('Running 0s')
  })

  test('marks aborted groups separately from used tools', () => {
    const part = toolPart({ state: 'aborted' })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part: part as any, key: 'call-1' }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('data-boring-agent-tool-state="aborted"')
    expect(html).toContain('Stopped custom_tool')
    expect(html).not.toContain('Tool calls: Used custom_tool')
    expect(html).not.toContain('data-boring-agent-tool-state="settled"')
    expect(html).not.toContain('Running 0s')
  })

  test('bounds expanded tool detail rows to the normal tool lane', () => {
    const part = toolPart({
      toolName: 'bash',
      state: 'output-error',
      errorText: 'command failed',
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup tools={[{ part: part as any, key: 'call-1' }]} mergedToolRenderers={{}} />,
    )

    expect(html).toContain('data-boring-agent-part="tool-group-details"')
    expect(html).toContain('max-w-2xl')
    expect(html).toContain('[&amp;_[data-boring-agent-part=tool-card]]:!my-0')
  })

  test('routes to an explicitly registered rendererId from tool output metadata', () => {
    const customRenderer = vi.fn((part: ToolPart) => (
      <div data-testid="custom-renderer">
        renderer={part.ui?.rendererId}; task={(part.ui?.details as { task?: string })?.task}; tool={part.toolName}
      </div>
    ))
    const part = toolPart({
      output: {
        content: [{ type: 'text', text: 'done' }],
        details: {
          ui: {
            rendererId: 'demo-card',
            details: { task: 'render this specially' },
          },
        },
      },
    })

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[{ part: part as any, key: 'call-1' }]}
        mergedToolRenderers={{ 'demo-card': customRenderer }}
      />,
    )

    expect(customRenderer).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'custom_tool',
      ui: { rendererId: 'demo-card', details: { task: 'render this specially' } },
    }))
    expect(html).toContain('renderer=demo-card')
    expect(html).toContain('task=render this specially')
    expect(html).toContain('tool=custom_tool')
  })

  test('falls back to the tool-name renderer when no rendererId is present', () => {
    const fallbackRenderer = vi.fn((part: ToolPart) => <div>fallback:{part.toolName}</div>)
    const part = toolPart()

    const html = renderToStaticMarkup(
      <ToolCallGroup
        tools={[{ part: part as any, key: 'call-1' }]}
        mergedToolRenderers={{ custom_tool: fallbackRenderer }}
      />,
    )

    expect(fallbackRenderer).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'custom_tool',
      ui: undefined,
    }))
    expect(html).toContain('fallback:custom_tool')
  })
})
