import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NavRail from '../NavRail'

describe('NavRail', () => {
  it('renders brand icon', () => {
    render(<NavRail onDestinationChange={vi.fn()} onNewChat={vi.fn()} />)
    const brand = screen.getByTestId('nav-rail-brand')
    expect(brand).toBeInTheDocument()
    expect(brand).toHaveTextContent('B')
  })

  it('renders new chat button', () => {
    render(<NavRail onDestinationChange={vi.fn()} onNewChat={vi.fn()} />)
    const newChat = screen.getByTestId('nav-rail-new-chat')
    expect(newChat).toBeInTheDocument()
  })

  it('renders history button', () => {
    render(<NavRail onDestinationChange={vi.fn()} onNewChat={vi.fn()} />)
    const history = screen.getByTestId('nav-rail-history')
    expect(history).toBeInTheDocument()
  })

  it('clicking history toggles active state', () => {
    const onChange = vi.fn()
    render(
      <NavRail
        activeDestination={null}
        onDestinationChange={onChange}
        onNewChat={vi.fn()}
      />
    )
    const history = screen.getByTestId('nav-rail-history')
    fireEvent.click(history)
    expect(onChange).toHaveBeenCalledWith('history')
  })

  it('clicking same active destination calls onDestinationChange(null) (close)', () => {
    const onChange = vi.fn()
    render(
      <NavRail
        activeDestination="history"
        onDestinationChange={onChange}
        onNewChat={vi.fn()}
      />
    )
    const history = screen.getByTestId('nav-rail-history')
    fireEvent.click(history)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('clicking new chat calls onNewChat', () => {
    const onNewChat = vi.fn()
    render(
      <NavRail
        onDestinationChange={vi.fn()}
        onNewChat={onNewChat}
      />
    )
    const newChat = screen.getByTestId('nav-rail-new-chat')
    fireEvent.click(newChat)
    expect(onNewChat).toHaveBeenCalled()
  })

  it('has role="navigation" with accessible label', () => {
    render(<NavRail onDestinationChange={vi.fn()} onNewChat={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    expect(nav).toBeInTheDocument()
  })
})
