import { renderToStaticMarkup } from 'react-dom/server'
import { describe, test, expect } from 'vitest'
import { DiffView } from '../DiffView'

describe('DiffView', () => {
  test('renders addition lines', () => {
    const html = renderToStaticMarkup(
      <DiffView oldString="" newString="hello\nworld" path="test.ts" />,
    )
    expect(html).toContain('data-testid="diff-view"')
    expect(html).toContain('test.ts')
    expect(html).toContain('+')
  })

  test('renders removal lines', () => {
    const html = renderToStaticMarkup(
      <DiffView oldString="hello\nworld" newString="" path="test.ts" />,
    )
    expect(html).toContain('-')
  })

  test('renders mixed changes', () => {
    const html = renderToStaticMarkup(
      <DiffView
        oldString="line1\nline2\nline3"
        newString="line1\nmodified\nline3"
        path="test.ts"
      />,
    )
    expect(html).toContain('+')
    expect(html).toContain('-')
    expect(html).toContain('test.ts')
  })

  test('renders no-change message for identical strings', () => {
    const html = renderToStaticMarkup(
      <DiffView oldString="same" newString="same" path="test.ts" />,
    )
    expect(html).toContain('data-testid="diff-no-change"')
    expect(html).toContain('No changes')
  })

  test('renders empty-file diff', () => {
    const html = renderToStaticMarkup(
      <DiffView oldString="" newString="new content" path="new.ts" />,
    )
    expect(html).toContain('new.ts')
    expect(html).toContain('new content')
  })

  test('shows replaceAll indicator', () => {
    const html = renderToStaticMarkup(
      <DiffView oldString="a" newString="b" path="f.ts" replaceAll />,
    )
    expect(html).toContain('(replace all)')
  })

  test('collapses long diffs with expand button', () => {
    const oldLines = Array.from({ length: 50 }, (_, i) => `old-${i}`).join('\n')
    const newLines = Array.from({ length: 50 }, (_, i) => `new-${i}`).join('\n')
    const html = renderToStaticMarkup(
      <DiffView oldString={oldLines} newString={newLines} path="big.ts" />,
    )
    expect(html).toContain('more lines')
  })
})
