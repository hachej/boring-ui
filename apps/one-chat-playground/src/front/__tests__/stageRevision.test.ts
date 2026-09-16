import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { Stage } from '../Stage'

describe('stage revision badge', () => {
  test('shows the intent revision beside a sketch label', () => {
    const html = renderToStaticMarkup(createElement(Stage, {
      screen: {
        what: 'page',
        url: 'http://localhost:6101/mockups/crm.html',
        title: 'Sketch: CRM',
        label: 'preview',
        revision: 3,
      },
    }))
    expect(html).toContain('>Sketch<')
    expect(html).toContain('data-testid="one-chat-stage-revision">v3</span>')
  })
})
