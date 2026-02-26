import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'

/**
 * LeftPaneHeader - Thin header bar for the left sidebar pane with collapse toggle.
 * Rendered only by the first panel in the sidebar.
 * Accepts children (e.g. UserMenu) rendered on the left side before the spacer.
 */
export function LeftPaneHeader({ onToggleSidebar, children }) {
  if (typeof onToggleSidebar !== 'function') return null
  return (
    <div className="left-pane-header">
      {children}
      <div className="left-pane-header-spacer" />
      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={onToggleSidebar}
        title="Collapse sidebar"
        aria-label="Collapse sidebar"
      >
        <ChevronLeft size={12} />
      </button>
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
      <button
        type="button"
        className="sidebar-section-toggle"
        onClick={onToggleSection}
        title={sectionCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        aria-label={sectionCollapsed ? `Expand ${title}` : `Collapse ${title}`}
      >
        {sectionCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </button>
      <span className="sidebar-section-title">{title}</span>
      <div className="sidebar-section-actions">
        {children}
      </div>
    </div>
  )
}
