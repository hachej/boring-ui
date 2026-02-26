import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react'

/**
 * SidebarSectionHeader - Shared header for left sidebar panels.
 *
 * Renders a consistent section header with:
 * - Section collapse toggle (chevron down/right) to vertically collapse the section
 * - Section title
 * - Optional right-side children (action buttons)
 * - Sidebar collapse toggle (chevron left) to collapse the entire left sidebar
 *
 * Props:
 * - title: Section name (e.g., "Files", "Data Catalog")
 * - sectionCollapsed: Whether this section is vertically collapsed
 * - onToggleSection: Callback to toggle section collapse
 * - onToggleSidebar: Callback to collapse/expand the entire left sidebar
 * - children: Optional action buttons rendered between title and sidebar toggle
 */
export default function SidebarSectionHeader({
  title,
  sectionCollapsed = false,
  onToggleSection,
  onToggleSidebar,
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
        {typeof onToggleSidebar === 'function' && (
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleSidebar}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
