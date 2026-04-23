import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { Composer, type ComposerHandle } from '../Composer'

describe('Composer ref compatibility', () => {
  test('accepts a typed ref used by ChatPanel', () => {
    const ref = createRef<ComposerHandle>()
    const html = renderToStaticMarkup(<Composer ref={ref} onSend={() => {}} />)

    expect(html).toContain('textarea')
  })
})
