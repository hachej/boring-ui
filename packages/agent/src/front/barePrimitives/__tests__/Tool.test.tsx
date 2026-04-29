import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tool, type ToolState } from '../Tool'

describe('Tool elapsed timer', () => {
  it('shows "Running…" for input-available state on initial render', () => {
    const html = renderToStaticMarkup(
      <Tool toolName="bash" toolCallId="tc-1" state="input-available" />,
    )
    expect(html).toContain('Running…')
    expect(html).not.toContain('Running… (')
  })

  it('shows "Running…" for input-streaming state on initial render', () => {
    const html = renderToStaticMarkup(
      <Tool toolName="bash" toolCallId="tc-2" state="input-streaming" />,
    )
    expect(html).toContain('Running…')
    expect(html).not.toContain('Running… (')
  })

  it('shows "Done" for output-available state', () => {
    const html = renderToStaticMarkup(
      <Tool toolName="bash" toolCallId="tc-3" state="output-available" />,
    )
    expect(html).toContain('Done')
    expect(html).not.toContain('Running…')
  })

  it('shows running indicator dot only for non-complete states', () => {
    const runningHtml = renderToStaticMarkup(
      <Tool toolName="bash" toolCallId="tc-4" state="input-available" />,
    )
    expect(runningHtml).toContain('aria-label="running"')

    const doneHtml = renderToStaticMarkup(
      <Tool toolName="bash" toolCallId="tc-5" state="output-available" />,
    )
    expect(doneHtml).not.toContain('aria-label="running"')
  })

  it('sets data-tool-state attribute', () => {
    const states: ToolState[] = ['input-streaming', 'input-available', 'output-available', 'output-error']
    for (const state of states) {
      const html = renderToStaticMarkup(
        <Tool toolName="bash" toolCallId="tc-x" state={state} />,
      )
      expect(html).toContain(`data-tool-state="${state}"`)
    }
  })
})
