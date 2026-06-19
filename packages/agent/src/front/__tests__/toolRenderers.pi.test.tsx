import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { resolveToolRendererForPart, shadcnDefaultToolRenderers, type ToolPart } from '../toolRenderers'

function makePart(overrides: Partial<ToolPart> & { toolName: string }): ToolPart {
  return {
    type: 'tool-call',
    toolCallId: 'call-1',
    state: 'output-available',
    ...overrides,
  }
}

describe('shadcn Pi-native tool renderer adapter', () => {
  test('safe fallback visibly surfaces an unresolved plugin renderer id', () => {
    const part = makePart({
      toolName: 'plugin_tool',
      ui: { rendererId: 'plugin-card' },
      input: { value: 1 },
      output: { ok: true },
    })

    const { renderer, part: resolvedPart, resolution } = resolveToolRendererForPart(part, shadcnDefaultToolRenderers)
    const html = renderToStaticMarkup(<>{renderer(resolvedPart)}</>)

    expect(resolution).toEqual({ key: '__fallback', source: 'fallback', requestedRendererId: 'plugin-card' })
    expect(html).toContain('plugin_tool')
    expect(html).toContain('renderer plugin-card unavailable')
  })

  test('rendererId wins over toolName when both renderers exist', () => {
    const rendererById = () => <div>renderer-id</div>
    const rendererByToolName = () => <div>tool-name</div>
    const part = makePart({ toolName: 'bash', ui: { rendererId: 'plugin-card' } })

    const { renderer, resolution } = resolveToolRendererForPart(part, {
      ...shadcnDefaultToolRenderers,
      'plugin-card': rendererById,
      bash: rendererByToolName,
    })

    expect(renderer).toBe(rendererById)
    expect(resolution.source).toBe('rendererId')
  })
})
