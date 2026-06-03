import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import type { BoringChatPart } from '../../../../shared/chat'
import type { ToolPart } from '../../../bareToolRenderers'

vi.mock('@hachej/boring-ui-kit', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) => <button {...props}>{children}</button>,
  Collapsible: ({ children }: { children: React.ReactNode }) => <div data-testid="collapsible">{children}</div>,
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
})
