import { useState, useRef, useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Sun, Moon, ArrowLeftRight, ChevronRight, Plus, Settings, Wrench, LogOut, AlertCircle, HelpCircle } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { ICON_SIZE_INLINE, ICON_SIZE_COMPACT, ICON_STROKE_WIDTH } from '../utils/iconTokens'
import { routes } from '../utils/routes'
import { Button } from './ui/button'
import { Avatar, AvatarFallback } from './ui/avatar'
import { Separator } from './ui/separator'

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
 * - onOpenWorkspaceSettings: optional callback for workspace settings action
 * - workspaceOptions: array of { workspace_id, name } for inline workspace switching
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
  showSwitchWorkspace = true,
  onSwitchWorkspace: _onSwitchWorkspace,
  onCreateWorkspace,
  onOpenUserSettings,
  onOpenWorkspaceSettings,
  workspaceOptions = [],
  onLogout,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [showWsList, setShowWsList] = useState(false)
  const menuRef = useRef(null)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const [collapsedMenuStyle, setCollapsedMenuStyle] = useState(null)
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const themeLabel = isDark ? 'Dark' : 'Light'

  const getFocusableMenuElements = () => {
    if (!dropdownRef.current) return []
    return Array.from(
      dropdownRef.current.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    )
  }

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false)
    setShowWsList(false)
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus())
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      const clickedTrigger = menuRef.current?.contains(event.target)
      const clickedMenu = dropdownRef.current?.contains(event.target)
      // Check if click is inside the workspace submenu portal
      const clickedSubmenu = event.target.closest?.('.user-menu-ws-submenu')
      if (!clickedTrigger && !clickedMenu && !clickedSubmenu) closeMenu(false)
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
        closeMenu(true)
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
    closeMenu(true)
  }

  // Workspace list for inline switching (filter out current)
  const switchableWorkspaces = workspaceOptions.filter(
    (ws) => (ws.workspace_id || ws.id) !== workspaceId,
  )
  const showInlineSwitch = showSwitchWorkspace && switchableWorkspaces.length > 0

  const switchItemRef = useRef(null)
  const [wsSubMenuStyle, setWsSubMenuStyle] = useState(null)

  // Position the ws submenu next to the switch button
  useEffect(() => {
    if (!showWsList || !switchItemRef.current) return
    const rect = switchItemRef.current.getBoundingClientRect()
    const subWidth = 200
    const padding = 8
    // Prefer right side; if no room, open left
    let left = rect.right + 4
    if (left + subWidth > window.innerWidth - padding) {
      left = rect.left - subWidth - 4
    }
    let top = rect.top
    const maxBottom = window.innerHeight - padding
    if (top + 200 > maxBottom) {
      top = maxBottom - 200
    }
    setWsSubMenuStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      minWidth: `${subWidth}px`,
      zIndex: 1001,
    })
  }, [showWsList])

  const actionItems = [
    ...(showInlineSwitch
      ? [{ key: 'switch', label: 'Switch workspace', icon: ArrowLeftRight, onClick: () => setShowWsList((v) => !v), noClose: true, hasSubmenu: true }]
      : []),
    { key: 'create', label: 'Create workspace', icon: Plus, onClick: onCreateWorkspace },
    ...(workspaceId && onOpenWorkspaceSettings
      ? [{ key: 'ws-settings', label: 'Workspace settings', icon: Wrench, onClick: onOpenWorkspaceSettings }]
      : []),
    { key: 'settings', label: 'User settings', icon: Settings, onClick: onOpenUserSettings },
    { key: 'logout', label: 'Logout', icon: LogOut, onClick: onLogout },
  ]

  const reactId = useId()
  // React's `useId()` includes characters (like `:`) that are valid in HTML ids but
  // awkward in CSS selectors; strip them for cleaner diagnostics and robust testing.
  const safeId = reactId.replace(/:/g, '')
  const triggerId = `user-menu-trigger-${safeId}`
  const menuId = `user-menu-dropdown-${safeId}`
  const isSignedIn = Boolean(String(email || '').trim())
  const displayEmail = isSignedIn ? String(email).trim() : 'Not signed in'
  const avatarLetter = isSignedIn ? displayEmail.charAt(0).toUpperCase() : ''
  const workspaceNameValue = String(workspaceName || '').trim()
  const isUuidWorkspaceName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceNameValue)
  const showWorkspace = workspaceNameValue.length > 0 && !isUuidWorkspaceName
  const workspaceLabel = showWorkspace
    ? workspaceNameValue
    : ''

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

  useEffect(() => {
    if (!isOpen) return
    const menuItems = Array.from(
      dropdownRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []
    )
    menuItems[0]?.focus()
  }, [isOpen])

  const handleMenuKeyDown = (event) => {
    if (!dropdownRef.current) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
      return
    }

    if (event.key === 'Tab') {
      const focusables = getFocusableMenuElements()
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
      return
    }

    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    const menuItems = Array.from(
      dropdownRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')
    )
    if (menuItems.length === 0) return
    event.preventDefault()
    const currentIndex = menuItems.indexOf(document.activeElement)
    if (event.key === 'Home') {
      menuItems[0].focus()
      return
    }
    if (event.key === 'End') {
      menuItems[menuItems.length - 1].focus()
      return
    }
    if (currentIndex === -1) {
      menuItems[0].focus()
      return
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex + delta + menuItems.length) % menuItems.length
    menuItems[nextIndex].focus()
  }

  const dropdown = (
    <div
      className={`user-menu-dropdown ${collapsed ? 'user-menu-dropdown-portal' : ''}`}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      ref={dropdownRef}
      onKeyDown={handleMenuKeyDown}
      style={collapsed ? collapsedMenuStyle || undefined : undefined}
    >
      <div className="user-menu-email">{displayEmail}</div>
      {workspaceLabel ? <div className="user-menu-workspace">{workspaceLabel}</div> : null}
      {statusMessage ? (
        <div
          className={`user-menu-status user-menu-status-${statusTone}`}
          role="alert"
        >
          <AlertCircle
            size={ICON_SIZE_COMPACT}
            strokeWidth={ICON_STROKE_WIDTH}
            className="user-menu-status-icon"
            aria-hidden="true"
          />
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
      <Separator className="user-menu-divider" />
      <Button
        type="button"
        variant="ghost"
        className="user-menu-item user-menu-item-appearance"
        onClick={toggleTheme}
        role="menuitem"
        aria-label={`Theme: ${themeLabel}`}
      >
        <span className="user-menu-item-left">
          {isDark ? (
            <Sun size={ICON_SIZE_INLINE} strokeWidth={ICON_STROKE_WIDTH} className="user-menu-item-icon" />
          ) : (
            <Moon size={ICON_SIZE_INLINE} strokeWidth={ICON_STROKE_WIDTH} className="user-menu-item-icon" />
          )}
          <span>{`Theme: ${themeLabel}`}</span>
        </span>
        <span className={`user-menu-theme-switch ${isDark ? 'is-dark' : 'is-light'}`} aria-hidden="true">
          <span className="user-menu-theme-knob" />
        </span>
      </Button>
      <Separator className="user-menu-divider" />
      {actionItems.map((item) => {
        const disabled = typeof item.onClick !== 'function' || disabledActions.includes(item.key)
        const ItemIcon = item.icon
        return (
          <div key={item.key} ref={item.key === 'switch' ? switchItemRef : undefined}>
            <Button
              type="button"
              variant="ghost"
              className={`user-menu-item ${disabled ? 'user-menu-item-disabled' : ''} ${item.hasSubmenu ? 'user-menu-item-submenu' : ''}`}
              onClick={() => item.noClose ? item.onClick() : runAction(item.onClick)}
              role="menuitem"
              disabled={disabled}
            >
              <span className="user-menu-item-left">
                {ItemIcon ? (
                  <ItemIcon
                    size={ICON_SIZE_INLINE}
                    strokeWidth={ICON_STROKE_WIDTH}
                    className="user-menu-item-icon"
                    aria-hidden="true"
                  />
                ) : null}
                {item.label}
              </span>
              {item.hasSubmenu && (
                <ChevronRight size={12} className="user-menu-item-chevron" aria-hidden="true" />
              )}
            </Button>
          </div>
        )
      })}
      {showWsList && createPortal(
        <div className="user-menu-ws-submenu" style={wsSubMenuStyle || undefined} ref={(el) => {
          // Include submenu in outside-click detection
          if (el) el._userMenuSubmenu = true
        }}>
          {switchableWorkspaces.map((ws) => {
            const wsId = ws.workspace_id || ws.id
            return (
              <a
                key={wsId}
                className="user-menu-ws-submenu-item"
                href={routes.controlPlane.workspaces.scope(wsId).path}
                onClick={() => closeMenu(true)}
              >
                <span className="user-menu-ws-item-name">{ws.name || wsId}</span>
              </a>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )

  return (
    <div
      className={`user-menu ${collapsed ? 'user-menu-collapsed' : ''}`}
      ref={menuRef}
    >
      <button
        className={`user-menu-trigger ${collapsed ? 'compact' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        id={triggerId}
        ref={triggerRef}
        aria-label="User menu"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls={isOpen ? menuId : undefined}
      >
        <Avatar className={`user-avatar ${isSignedIn ? '' : 'user-avatar-anonymous'}`}>
          <AvatarFallback className="user-avatar-fallback">
            {isSignedIn ? (
              avatarLetter
            ) : (
              <HelpCircle
                size={ICON_SIZE_INLINE}
                strokeWidth={ICON_STROKE_WIDTH}
                className="user-avatar-help-icon"
                aria-hidden="true"
              />
            )}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <span className="user-menu-trigger-meta">
            <span className="user-menu-trigger-primary">{displayEmail}</span>
            {workspaceLabel ? <span className="user-menu-trigger-secondary">{workspaceLabel}</span> : null}
          </span>
        )}
      </button>

      {isOpen && (collapsed ? createPortal(dropdown, document.body) : dropdown)}
    </div>
  )
}
