import { useState, useRef, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

/**
 * UserMenu - Avatar with dropdown menu for user and workspace actions
 *
 * Props:
 * - email: User email for avatar letter and display
 * - workspaceName: Workspace name to display
 * - workspaceId: Workspace ID for actions
 * - collapsed: Render compact avatar-only trigger for collapsed sidebar
 * - onSwitchWorkspace: optional callback for switch action
 * - onCreateWorkspace: optional callback for create action
 * - onOpenUserSettings: optional callback for settings action
 * - onLogout: optional callback for logout action
 */
export default function UserMenu({
  email,
  workspaceName,
  workspaceId,
  collapsed = false,
  statusMessage = '',
  statusTone = 'error',
  onRetry,
  disabledActions = [],
  onSwitchWorkspace,
  onCreateWorkspace,
  onOpenUserSettings,
  onLogout,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef(null)
  const dropdownRef = useRef(null)
  const [collapsedMenuStyle, setCollapsedMenuStyle] = useState(null)
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  // Get first letter of email (uppercase) for avatar
  const avatarLetter = email ? email.charAt(0).toUpperCase() : '?'

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      const clickedTrigger = menuRef.current?.contains(event.target)
      const clickedMenu = dropdownRef.current?.contains(event.target)
      if (!clickedTrigger && !clickedMenu) setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const runAction = (action) => {
    if (typeof action === 'function') {
      try {
        const result = action({ workspaceId })
        if (result && typeof result.catch === 'function') {
          result.catch(() => {})
        }
      } catch {
        // failure UX is handled by parent flows; keep menu interactions resilient
      }
    }
    setIsOpen(false)
  }

  const actionItems = [
    { key: 'switch', label: 'Switch workspace', onClick: onSwitchWorkspace },
    { key: 'create', label: 'Create workspace', onClick: onCreateWorkspace },
    { key: 'settings', label: 'User settings', onClick: onOpenUserSettings },
    { key: 'logout', label: 'Logout', onClick: onLogout },
  ]

  const reactId = useId()
  // React's `useId()` includes characters (like `:`) that are valid in HTML ids but
  // awkward in CSS selectors; strip them for cleaner diagnostics and robust testing.
  const safeId = reactId.replace(/:/g, '')
  const triggerId = `user-menu-trigger-${safeId}`
  const menuId = `user-menu-dropdown-${safeId}`
  const displayEmail = email || 'Signed in user'
  const workspaceNameValue = String(workspaceName || '').trim()
  const isUuidWorkspaceName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceNameValue)
  const showWorkspace = workspaceNameValue.length > 0 && !isUuidWorkspaceName
  const workspaceLabel = showWorkspace
    ? `workspace: ${workspaceName}`
    : workspaceId ? `workspace id: ${workspaceId}` : 'workspace: not selected'

  useEffect(() => {
    if (!isOpen || !collapsed || !menuRef.current) return

    const updateCollapsedMenuPosition = () => {
      const rect = menuRef.current.getBoundingClientRect()
      const menuWidth = 220
      const menuHeight = 240
      const horizontalGap = 8
      const viewportPadding = 8
      const left = Math.min(
        rect.right + horizontalGap,
        window.innerWidth - menuWidth - viewportPadding,
      )
      const top = Math.min(
        Math.max(viewportPadding, rect.bottom - menuHeight),
        window.innerHeight - menuHeight - viewportPadding,
      )

      setCollapsedMenuStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        minWidth: `${menuWidth}px`,
        zIndex: 1000,
      })
    }

    updateCollapsedMenuPosition()
    window.addEventListener('resize', updateCollapsedMenuPosition)
    window.addEventListener('scroll', updateCollapsedMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateCollapsedMenuPosition)
      window.removeEventListener('scroll', updateCollapsedMenuPosition, true)
    }
  }, [isOpen, collapsed])

  const dropdown = (
    <div
      className={`user-menu-dropdown ${collapsed ? 'user-menu-dropdown-portal' : ''}`}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      ref={dropdownRef}
      style={collapsed ? collapsedMenuStyle || undefined : undefined}
    >
      <div className="user-menu-email">{displayEmail}</div>
      <div className="user-menu-workspace">{workspaceLabel}</div>
      {statusMessage ? (
        <div
          className={`user-menu-status user-menu-status-${statusTone}`}
          role="alert"
        >
          <span className="user-menu-status-text">{statusMessage}</span>
          {typeof onRetry === 'function' ? (
            <button
              type="button"
              className="user-menu-status-retry"
              onClick={() => {
                try {
                  const result = onRetry()
                  if (result && typeof result.catch === 'function') {
                    result.catch(() => {})
                  }
                } catch {
                  // ignore retry errors; status will be updated by parent flows if needed
                }
              }}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="user-menu-divider" />
      <button
        className="user-menu-item user-menu-item-appearance"
        onClick={toggleTheme}
        role="menuitem"
      >
        {isDark ? <Sun size={14} /> : <Moon size={14} />}
        <span>Appearance: {isDark ? 'Dark' : 'Light'}</span>
      </button>
      <div className="user-menu-divider" />
      {actionItems.map((item) => {
        const disabled = typeof item.onClick !== 'function' || disabledActions.includes(item.key)
        return (
          <button
            key={item.key}
            className={`user-menu-item ${disabled ? 'user-menu-item-disabled' : ''}`}
            onClick={() => runAction(item.onClick)}
            role="menuitem"
            disabled={disabled}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div
      className={`user-menu ${collapsed ? 'user-menu-collapsed' : ''}`}
      ref={menuRef}
    >
      <button
        className={`user-menu-trigger ${collapsed ? 'compact' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        id={triggerId}
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={isOpen ? menuId : undefined}
      >
        <span className="user-avatar">{avatarLetter}</span>
        {!collapsed && (
          <span className="user-menu-trigger-meta">
            <span className="user-menu-trigger-primary">{displayEmail}</span>
            <span className="user-menu-trigger-secondary">{workspaceLabel}</span>
          </span>
        )}
      </button>

      {isOpen && (collapsed ? createPortal(dropdown, document.body) : dropdown)}
    </div>
  )
}
