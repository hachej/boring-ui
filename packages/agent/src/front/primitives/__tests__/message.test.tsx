// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MessageResponse } from '../message'

describe('MessageResponse', () => {
  test('renders filename inline code as a quiet chip', async () => {
    render(<MessageResponse>Open `README.md` before editing.</MessageResponse>)

    const filename = await screen.findByText('README.md')
    expect(filename.tagName).toBe('CODE')
    expect(filename.className).toContain('bg-muted/55')
    expect(filename.className).not.toContain('border')
  })
})
