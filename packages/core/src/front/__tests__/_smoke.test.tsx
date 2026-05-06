// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmokeButton } from '../_smoke'

describe('@hachej/boring-ui-kitsmoke', () => {
  it('renders a Button from @hachej/boring-ui-kit, () => {
    render(<SmokeButton />)
    expect(screen.getByRole('button', { name: 'Smoke' })).toBeDefined()
  })
})
