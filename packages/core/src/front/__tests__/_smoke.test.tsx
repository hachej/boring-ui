// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmokeButton } from '../_smoke'

describe('@boring/ui smoke', () => {
  it('renders a Button from @boring/ui', () => {
    render(<SmokeButton />)
    expect(screen.getByRole('button', { name: 'Smoke' })).toBeDefined()
  })
})
