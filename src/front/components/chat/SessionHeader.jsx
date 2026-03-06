import { ChevronDown, Plus } from 'lucide-react'

const SessionHeader = ({
  title = 'New conversation',
  onTitleClick,
  onNewSession,
  showDropdown = true,
  isDropdownOpen = false,
  dropdownMenuId = '',
  triggerRef = null,
}) => {
  return (
    <div className="claude-session-header">
      <button
        type="button"
        className="claude-session-trigger"
        ref={triggerRef}
        onClick={onTitleClick}
        aria-label={`Switch session. Current session: ${title}`}
        aria-haspopup={showDropdown ? 'menu' : undefined}
        aria-expanded={showDropdown ? isDropdownOpen : undefined}
        aria-controls={showDropdown && dropdownMenuId ? dropdownMenuId : undefined}
      >
        <span className="claude-session-title">{title}</span>
        {showDropdown && <ChevronDown size={18} className="claude-session-chevron" aria-hidden="true" />}
      </button>

      <button
        type="button"
        className="claude-session-new"
        onClick={onNewSession}
        title="New conversation"
      >
        <Plus size={18} aria-hidden="true" />
        <span>New</span>
      </button>
    </div>
  )
}

export default SessionHeader
