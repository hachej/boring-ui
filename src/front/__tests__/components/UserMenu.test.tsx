import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import UserMenu from '../../components/UserMenu'
import { ThemeProvider } from '../../hooks/useTheme'

const makeProps = () => ({
  email: 'john@example.com',
  workspaceName: 'My Workspace',
  workspaceId: 'ws-123',
  onSwitchWorkspace: vi.fn(),
  onCreateWorkspace: vi.fn(),
  onOpenUserSettings: vi.fn(),
  onLogout: vi.fn(),
})

const renderWithTheme = (ui) => render(<ThemeProvider>{ui}</ThemeProvider>)

describe('UserMenu', () => {
  describe('Avatar Rendering', () => {
    it('renders first letter of email as avatar', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('J')
    })

    it('renders anonymous help icon when email is missing', () => {
      const { container } = renderWithTheme(<UserMenu {...makeProps()} email="" />)
      expect(container.querySelector('.user-avatar-anonymous')).toBeInTheDocument()
      expect(container.querySelector('.user-avatar-help-icon')).toBeInTheDocument()
    })
  })

  describe('Dropdown Toggle', () => {
    it('opens and closes when trigger is clicked', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)

      const trigger = screen.getByRole('button', { name: 'User menu' })
      fireEvent.click(trigger)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.click(trigger)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes when clicking outside', () => {
      renderWithTheme(
        <div>
          <UserMenu {...makeProps()} />
          <button data-testid="outside">Outside</button>
        </div>
      )

      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      fireEvent.mouseDown(screen.getByTestId('outside'))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Dropdown Content', () => {
    it('shows identity/workspace details and expected shell controls', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

      const menu = screen.getByRole('menu')
      expect(within(menu).getByText('john@example.com')).toBeInTheDocument()
      expect(within(menu).getByText('workspace: My Workspace')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Switch workspace' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'User settings' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument()
    })

    it('invokes callbacks and closes when action is selected', () => {
      const props = makeProps()
      renderWithTheme(<UserMenu {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace' }))

      expect(props.onSwitchWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('safely handles async callback rejection paths', () => {
      const props = makeProps()
      props.onSwitchWorkspace = vi.fn().mockRejectedValue(new Error('network failure'))
      renderWithTheme(<UserMenu {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Switch workspace' }))

      expect(props.onSwitchWorkspace).toHaveBeenCalledWith({ workspaceId: 'ws-123' })
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('renders disabled action items when callbacks are not provided', () => {
      renderWithTheme(<UserMenu email="john@example.com" workspaceName="My Workspace" workspaceId="ws-123" />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

      expect(screen.getByRole('menuitem', { name: 'Switch workspace' })).toBeDisabled()
      expect(screen.getByRole('menuitem', { name: 'Create workspace' })).toBeDisabled()
      expect(screen.getByRole('menuitem', { name: 'User settings' })).toBeDisabled()
      expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeDisabled()
    })

    it('shows status banner, supports retry, and disables specified actions', () => {
      const props = makeProps()
      const onRetry = vi.fn()
      renderWithTheme(
        <UserMenu
          {...props}
          statusMessage="Not signed in."
          statusTone="error"
          onRetry={onRetry}
          disabledActions={['switch']}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Not signed in.')
      expect(screen.getByRole('menuitem', { name: 'Switch workspace' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
      // Retry should not close the menu (user may want to see the refreshed state).
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  describe('Accessibility and Classes', () => {
    it('sets expected aria attributes', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      const trigger = screen.getByRole('button', { name: 'User menu' })
      expect(trigger).toHaveAttribute('aria-haspopup', 'true')
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })

    it('applies expected shell class names', () => {
      const { container } = renderWithTheme(<UserMenu {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

      expect(container.querySelector('.user-menu')).toBeInTheDocument()
      expect(container.querySelector('.user-avatar')).toBeInTheDocument()
      expect(container.querySelector('.user-menu-dropdown')).toBeInTheDocument()
      expect(container.querySelector('.user-menu-item')).toBeInTheDocument()
    })

    it('supports arrow-key navigation across menu items', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

      const appearance = screen.getByRole('menuitem', { name: /Theme:/ })
      const switchWorkspace = screen.getByRole('menuitem', { name: 'Switch workspace' })
      const createWorkspace = screen.getByRole('menuitem', { name: 'Create workspace' })

      expect(appearance).toHaveFocus()
      fireEvent.keyDown(appearance, { key: 'ArrowDown' })
      expect(switchWorkspace).toHaveFocus()
      fireEvent.keyDown(switchWorkspace, { key: 'ArrowDown' })
      expect(createWorkspace).toHaveFocus()
      fireEvent.keyDown(createWorkspace, { key: 'ArrowUp' })
      expect(switchWorkspace).toHaveFocus()
    })

    it('traps Tab focus within the open dropdown', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

      const firstItem = screen.getByRole('menuitem', { name: /Theme:/ })
      const lastItem = screen.getByRole('menuitem', { name: 'Logout' })

      lastItem.focus()
      fireEvent.keyDown(lastItem, { key: 'Tab' })
      expect(firstItem).toHaveFocus()

      firstItem.focus()
      fireEvent.keyDown(firstItem, { key: 'Tab', shiftKey: true })
      expect(lastItem).toHaveFocus()
    })

    it('closes on Escape and restores focus to trigger', () => {
      renderWithTheme(<UserMenu {...makeProps()} />)
      const trigger = screen.getByRole('button', { name: 'User menu' })
      fireEvent.click(trigger)

      const menu = screen.getByRole('menu')
      fireEvent.keyDown(menu, { key: 'Escape' })

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    })
  })
})
