import { ChevronDown, ChevronRight, PanelLeftClose, FolderOpen, GitBranch, Search } from 'lucide-react'
import Tooltip from './Tooltip'

/**
 * LeftPaneHeader - Thin header bar for the left sidebar pane with collapse toggle.
 * Rendered only by the first panel in the sidebar.
 */
export function LeftPaneHeader({
  onToggleSidebar,
  appName,
  viewMode = 'files',
  onSetViewMode,
  onToggleSearch,
  searchExpanded = false,
}) {
  if (typeof onToggleSidebar !== 'function') return null
  return (
    <div className="left-pane-header left-pane-header-flat">
      <span className="left-pane-brand-title">{appName || 'workspace'}</span>
      <div className="left-pane-header-actions">
        <div className="sidebar-view-toggle" role="tablist" aria-label="Sidebar view mode">
          <Tooltip label="File tree">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'files' ? 'active' : ''}`}
              onClick={() => onSetViewMode?.('files')}
              aria-label="File tree view"
              role="tab"
              aria-selected={viewMode === 'files'}
            >
              <FolderOpen size={14} />
            </button>
          </Tooltip>
          <Tooltip label="Git changes">
            <button
              type="button"
              className={`view-toggle-btn ${viewMode === 'changes' ? 'active' : ''}`}
              onClick={() => onSetViewMode?.('changes')}
              aria-label="Git changes view"
              role="tab"
              aria-selected={viewMode === 'changes'}
            >
              <GitBranch size={14} />
            </button>
          </Tooltip>
        </div>
        <Tooltip
          label={searchExpanded ? 'Hide search' : 'Search files'}
          shortcut="Ctrl+P"
        >
          <button
            type="button"
            className={`sidebar-action-btn ${searchExpanded ? 'active' : ''}`}
            onClick={onToggleSearch}
            aria-label={searchExpanded ? 'Hide search' : 'Search files'}
          >
            <Search size={13} />
          </button>
        </Tooltip>
        <Tooltip label="Collapse sidebar">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleSidebar}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * SidebarSectionHeader - Section header for sub-components within the left sidebar.
 *
 * Renders:
 * - Section collapse toggle (chevron down/right) to vertically collapse the section
 * - Section title
 * - Optional right-side children (action buttons)
 *
 * Props:
 * - title: Section name (e.g., "Files", "Data Catalog")
 * - sectionCollapsed: Whether this section is vertically collapsed
 * - onToggleSection: Callback to toggle section collapse
 * - children: Optional action buttons rendered between title and spacer
 */
export default function SidebarSectionHeader({
  title,
  sectionCollapsed = false,
  onToggleSection,
  children,
}) {
  return (
    <div className="sidebar-section-header">
      <Tooltip label={sectionCollapsed ? `Expand ${title}` : `Collapse ${title}`}>
        <button
          type="button"
          className="sidebar-section-toggle"
          onClick={onToggleSection}
          aria-label={sectionCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {sectionCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
      </Tooltip>
      <span className="sidebar-section-title">{title}</span>
      <div className="sidebar-section-actions">
        {children}
      </div>
    </div>
  )
}
