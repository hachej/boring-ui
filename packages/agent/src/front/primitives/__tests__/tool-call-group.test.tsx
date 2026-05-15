import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { ToolPart } from '../../bareToolRenderers'

vi.mock('@hachej/boring-ui-kit', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div data-testid="collapsible">{children}</div>,
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
