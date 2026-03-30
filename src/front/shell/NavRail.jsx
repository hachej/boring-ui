import React, { useCallback } from 'react'
import { Plus, Clock, Settings, User } from 'lucide-react'

/**
 * NavRail - 48px icon strip, always visible on the left edge.
 *
 * Provides quick access to: new chat, session history, workspace, settings, profile.
 * Clicking a destination toggles the BrowseDrawer open/closed.
 * Clicking the same active destination again closes the drawer (sets null).
 *
 * Props:
 *   activeDestination  - string|null  currently active drawer destination
 *   onDestinationChange - (dest: string|null) => void
 *   onNewChat          - () => void  create a new chat session
 */
export default function NavRail({
  activeDestination = null,
  onDestinationChange,
  onNewChat,
}) {
  const toggle = useCallback(
    (destination) => {
      if (activeDestination === destination) {
        onDestinationChange(null)
      } else {
        onDestinationChange(destination)
      }
    },
    [activeDestination, onDestinationChange]
  )

  return (
    <nav
      className="nav-rail"
      role="navigation"
      aria-label="Main navigation"
      data-testid="nav-rail"
    >
      <div className="nav-rail-brand" aria-hidden="true" data-testid="nav-rail-brand">
        B
      </div>

      <button
        className="rail-icon-btn rail-new-icon"
        title="New chat"
        aria-label="New chat"
        data-testid="nav-rail-new-chat"
        onClick={onNewChat}
      >
        <Plus size={16} />
      </button>

      <div className="rail-sep" />

      <button
        className={`rail-icon-btn${activeDestination === 'history' ? ' active' : ''}`}
        title="Session history"
        aria-label="Session history"
        data-testid="nav-rail-history"
        onClick={() => toggle('history')}
      >
        <Clock size={17} />
      </button>

      <div className="rail-spacer" />
      <div className="rail-sep" />

      <button
        className="rail-icon-btn"
        title="Settings"
        aria-label="Settings"
        data-testid="nav-rail-settings"
        onClick={() => toggle('settings')}
      >
        <Settings size={17} />
      </button>

      <button
        className="rail-icon-btn"
        title="Profile"
        aria-label="Profile"
        data-testid="nav-rail-profile"
      >
        <User size={17} />
      </button>
    </nav>
  )
}
