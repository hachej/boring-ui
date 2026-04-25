// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmokeButton } from '../_smoke'

describe('workspace ui-shadcn smoke', () => {
  it('renders a Button from @boring/workspace/ui-shadcn', () => {
    render(<SmokeButton />)
    expect(screen.getByRole('button', { name: 'Smoke' })).toBeDefined()
  })
})
