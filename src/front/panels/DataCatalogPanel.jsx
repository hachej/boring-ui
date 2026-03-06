import { Database, FolderOpen, GitBranch, Search } from 'lucide-react'
import SidebarSectionHeader, {
  CollapsedSidebarActivityBar,
  LeftPaneHeader,
} from '../components/SidebarSectionHeader'

export default function DataCatalogPanel({ params }) {
  const {
    collapsed,
    onToggleCollapse,
    showSidebarToggle,
    appName,
    sectionCollapsed,
    onToggleSection,
    onActivateSidebarPanel,
    activeSidebarPanelId,
  } = params

  if (collapsed) {
    return (
      <div className="panel-content datacatalog-panel">
        {showSidebarToggle && (
          <CollapsedSidebarActivityBar
            onExpandSidebar={onToggleCollapse}
            items={[
              {
                id: 'files',
                label: 'Files',
                icon: FolderOpen,
                active: activeSidebarPanelId === 'filetree',
                onClick: () => onActivateSidebarPanel?.('filetree', { mode: 'files' }),
              },
              {
                id: 'data-catalog',
                label: 'Data Catalog',
                icon: Database,
                active: activeSidebarPanelId === 'data-catalog',
                onClick: () => onActivateSidebarPanel?.('data-catalog'),
              },
              {
                id: 'git',
                label: 'Git Changes',
                icon: GitBranch,
                active: false,
                onClick: () => onActivateSidebarPanel?.('filetree', { mode: 'changes' }),
              },
              {
                id: 'search',
                label: 'Quick Search',
                icon: Search,
                active: false,
                onClick: () => onActivateSidebarPanel?.('filetree', { mode: 'search' }),
              },
            ]}
          />
        )}
      </div>
    )
  }

  return (
    <div className="panel-content datacatalog-panel">
      {showSidebarToggle && (
        <LeftPaneHeader onToggleSidebar={onToggleCollapse} appName={appName} />
      )}
      <SidebarSectionHeader
        title="Data Catalog"
        icon={Database}
        sectionCollapsed={sectionCollapsed}
        onToggleSection={onToggleSection}
      />
      {!sectionCollapsed && (
        <div className="datacatalog-body">
          <div className="file-tree datacatalog-tree" role="tree" aria-label="Data Catalog">
            <div className="file-item datacatalog-item" role="treeitem">
              <span className="file-item-icon">
                <Database size={14} className="datacatalog-placeholder-icon" />
              </span>
              <span className="file-item-name">No data sources connected</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
