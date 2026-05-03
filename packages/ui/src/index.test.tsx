import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge, Button, Input, Separator, Textarea, cn } from './index'

describe('@boring/ui primitives', () => {
  it('merges Tailwind classes predictably', () => {
    expect(cn('px-2 text-sm', false, 'px-4')).toBe('text-sm px-4')
  })

  it('renders the core primitives with stable data slots', () => {
    const html = renderToStaticMarkup(
      <div>
        <Button variant="ghost" size="icon-sm">Open</Button>
        <Badge variant="secondary">Ready</Badge>
        <Input aria-label="Name" />
        <Textarea aria-label="Message" />
        <Separator />
      </div>,
    )

    expect(html).toContain('data-slot="button"')
    expect(html).toContain('data-variant="ghost"')
    expect(html).toContain('data-size="icon-sm"')
    expect(html).toContain('data-slot="badge"')
    expect(html).toContain('data-slot="input"')
    expect(html).toContain('data-slot="textarea"')
    expect(html).toContain('data-slot="separator"')
  })
})
