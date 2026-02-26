import React, { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Folder, FolderOpen, FolderInput, ChevronRight, ChevronDown, MoreHorizontal, Settings } from 'lucide-react'
import { apiFetchJson, getHttpErrorDetail } from '../utils/transport'
import { routes } from '../utils/routes'
import { getFileIcon } from '../utils/fileIcons'

const configPath = import.meta.env.VITE_CONFIG_PATH || ''

// Section icons by config key (not path name)
const SECTION_ICONS = {
  projects: Folder,
  sources: FolderInput,
}

// Capitalize first letter for display
const formatSectionLabel = (path) => {
  if (!path) return 'Other'
  const name = path.replace(/^\./, '') // Remove leading dot
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export default function FileTree({ onOpen, onOpenToSide, onFileDeleted, onFileRenamed, onFileMoved, projectRoot, activeFile, creatingFile, onFileCreated, onCancelCreate }) {
  const [entries, setEntries] = useState([])
  const [expandedDirs, setExpandedDirs] = useState({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [gitStatus, setGitStatus] = useState({})
  const [contextMenu, setContextMenu] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [newFileInput, setNewFileInput] = useState(null) // { parentDir: string, name: string }
  const [kurtConfig, setKurtConfig] = useState(null)
  // Keep "Other" expanded by default so repos without configured sections
  // still show files immediately instead of appearing empty.
  const [collapsedSections, setCollapsedSections] = useState({ other: false })
  const renameInputRef = useRef(null)
  const newFileInputRef = useRef(null)

  // Use ref to track expandedDirs for polling (avoids stale closure)
  const expandedDirsRef = useRef(expandedDirs)
  useEffect(() => {
    expandedDirsRef.current = expandedDirs
  }, [expandedDirs])

  const fetchDir = (dirPath) => {
    const route = routes.files.list(dirPath)
    return apiFetchJson(route.path, { query: route.query })
      .then(({ data }) => data.entries || [])
      .catch(() => [])
  }

  const fetchGitStatus = () => {
    const route = routes.git.status()
    apiFetchJson(route.path, { query: route.query })
      .then(({ data }) => {
        if (data.available && data.files) {
          setGitStatus(data.files)
        }
      })
      .catch(() => {})
  }

  const refreshTree = useCallback(async () => {
    const root = await fetchDir('.')
    setEntries(root)
    // Refresh expanded dirs in parallel, updating in-place
    // Use ref to get current expanded dirs (avoids stale closure in setInterval)
    const paths = Object.keys(expandedDirsRef.current)
    if (paths.length > 0) {
      const results = await Promise.all(paths.map(fetchDir))
      setExpandedDirs((prev) => {
        const updated = { ...prev }
        paths.forEach((path, i) => {
          updated[path] = results[i]
        })
        return updated
      })
    }
    fetchGitStatus()
  }, [])

  // Fetch config for section organization
  const fetchConfig = () => {
    const route = routes.config.get(configPath)
    apiFetchJson(route.path, { query: route.query })
      .then(async ({ data }) => {
        if (data.paths) {
          setKurtConfig(data.paths)
          // Auto-expand section folders on initial load (projects, sources)
          const sectionPaths = ['projects', 'sources']
          const toExpand = {}
          const toCollapse = {}
          for (const key of sectionPaths) {
            const path = data.paths[key]
            if (path) {
              const children = await fetchDir(path)
              // Store even empty arrays so we know folder was loaded
              toExpand[path] = children
              // Auto-collapse empty sections
              if (children.length === 0) {
                toCollapse[key] = true
              }
            }
          }
          // Use functional update to merge with current state
          setExpandedDirs((prev) => ({ ...prev, ...toExpand }))
          // Collapse empty sections
          if (Object.keys(toCollapse).length > 0) {
            setCollapsedSections((prev) => ({ ...prev, ...toCollapse }))
          }
        }
      })
      .catch(() => {})
  }

  useEffect(() => {
    let retryCount = 0
    const maxRetries = 10

    const initialFetch = () => {
      fetchDir('.').then((result) => {
        if (result.length > 0 || retryCount >= maxRetries) {
          setEntries(result)
        } else {
          // Retry if empty (server might not be ready)
          retryCount++
          setTimeout(initialFetch, 300)
        }
      })
    }

    initialFetch()
    fetchGitStatus()
    fetchConfig()

    // Poll for git status changes
    const gitInterval = setInterval(fetchGitStatus, 5000)
    // Poll for file tree changes (new/deleted files)
    const treeInterval = setInterval(refreshTree, 3000)

    return () => {
      clearInterval(gitInterval)
      clearInterval(treeInterval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clear search results immediately when query is cleared (before any async operation)
  // This ensures the tree renders correctly without any stale search results
  const trimmedQuery = searchQuery.trim()

  useEffect(() => {
    // Immediately clear results if query is empty
    if (!trimmedQuery) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    const timeoutId = setTimeout(() => {
      const route = routes.files.search(trimmedQuery)
      apiFetchJson(route.path, { query: route.query })
        .then(({ data }) => {
          // Only update if query hasn't changed (prevent stale results)
          setSearchResults(data.results || [])
          setIsSearching(false)
        })
        .catch(() => {
          setSearchResults([])
          setIsSearching(false)
        })
    }, 200)

    return () => clearTimeout(timeoutId)
  }, [trimmedQuery])

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renaming])

  useEffect(() => {
    if (newFileInput && newFileInputRef.current) {
      newFileInputRef.current.focus()
    }
  }, [newFileInput])

  // Handle creatingFile prop from parent (header button)
  useEffect(() => {
    if (creatingFile) {
      setNewFileInput({ parentDir: '', name: '' })
    }
  }, [creatingFile])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const handleClick = async (entry) => {
    if (entry.is_dir) {
      const path = entry.path
      if (expandedDirs[path]) {
        setExpandedDirs((prev) => {
          const next = { ...prev }
          delete next[path]
          return next
        })
      } else {
        const children = await fetchDir(path)
        setExpandedDirs((prev) => ({
          ...prev,
          [path]: children,
        }))
      }
    } else {
      onOpen(entry.path)
    }
  }

  const handleContextMenu = (event, entry) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry,
    })
  }

  const handleRename = () => {
    if (!contextMenu) return
    setRenaming({
      entry: contextMenu.entry,
      newName: contextMenu.entry.name,
    })
    setContextMenu(null)
  }

  const handleCopyPath = (absolute = false) => {
    if (!contextMenu) return
    const entry = contextMenu.entry
    setContextMenu(null)

    const pathToCopy = absolute && projectRoot
      ? `${projectRoot}/${entry.path}`
      : entry.path
    navigator.clipboard.writeText(pathToCopy).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = pathToCopy
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    })
  }

  const handleDelete = async () => {
    if (!contextMenu) return
    const entry = contextMenu.entry
    setContextMenu(null)

    const confirmMsg = entry.is_dir
      ? `Delete folder "${entry.name}" and all its contents?`
      : `Delete file "${entry.name}"?`

    if (!window.confirm(confirmMsg)) return

    try {
      const route = routes.files.delete(entry.path)
      const { response, data } = await apiFetchJson(route.path, { query: route.query, method: 'DELETE' })
      if (response.ok) {
        await refreshTree()
        onFileDeleted?.(entry.path)
      } else {
        alert(`Failed to delete: ${getHttpErrorDetail(response, data, 'Delete failed')}`)
      }
    } catch (err) {
      alert(`Failed to delete: ${err.message}`)
    }
  }

  const handleRenameSubmit = async () => {
    if (!renaming || !renaming.newName.trim()) {
      setRenaming(null)
      return
    }

    const oldPath = renaming.entry.path
    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : ''
    const newPath = parentDir ? `${parentDir}/${renaming.newName}` : renaming.newName

    if (oldPath === newPath) {
      setRenaming(null)
      return
    }

    try {
      const route = routes.files.rename()
      const { response, data } = await apiFetchJson(route.path, {
        query: route.query,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
      })
      if (response.ok) {
        setRenaming(null)
        await refreshTree()
        onFileRenamed?.(oldPath, newPath)
      } else {
        alert(`Failed to rename: ${getHttpErrorDetail(response, data, 'Rename failed')}`)
      }
    } catch (err) {
      alert(`Failed to rename: ${err.message}`)
    }
  }

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      setRenaming(null)
    }
  }

  const handleNewFile = (parentDir = '') => {
    setContextMenu(null)
    // If parentDir is specified and it's a folder, expand it
    if (parentDir && !expandedDirs[parentDir]) {
      fetchDir(parentDir).then((children) => {
        setExpandedDirs((prev) => ({
          ...prev,
          [parentDir]: children,
        }))
      })
    }
    setNewFileInput({ parentDir, name: '' })
  }

  const handleNewFileSubmit = async () => {
    if (!newFileInput || !newFileInput.name.trim()) {
      setNewFileInput(null)
      onCancelCreate?.()
      return
    }

    const fileName = newFileInput.name.trim()
    const filePath = newFileInput.parentDir
      ? `${newFileInput.parentDir}/${fileName}`
      : fileName

    try {
      const route = routes.files.write(filePath)
      const { response, data } = await apiFetchJson(route.path, {
        query: route.query,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      })
      if (response.ok) {
        setNewFileInput(null)
        await refreshTree()
        onFileCreated?.(filePath)
      } else {
        alert(`Failed to create file: ${getHttpErrorDetail(response, data, 'Create file failed')}`)
      }
    } catch (err) {
      alert(`Failed to create file: ${err.message}`)
    }
  }

  const handleNewFileKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleNewFileSubmit()
    } else if (e.key === 'Escape') {
      setNewFileInput(null)
      onCancelCreate?.()
    }
  }

  const handleSearchResultClick = (result) => {
    onOpen(result.path)
    setSearchQuery('')
  }

  const getFileStatus = (path) => {
    return gitStatus[path] || null
  }

  const getDirStatus = (dirPath) => {
    const prefix = dirPath + '/'
    for (const filePath of Object.keys(gitStatus)) {
      if (filePath.startsWith(prefix) || filePath === dirPath) {
        return true
      }
    }
    return false
  }

  const renderStatusBadge = (status) => {
    if (!status) return null

    const statusConfig = {
      M: { label: 'M', className: 'git-status-modified', title: 'Modified' },
      U: { label: 'U', className: 'git-status-untracked', title: 'Untracked' },
      A: { label: 'A', className: 'git-status-added', title: 'Added' },
      D: { label: 'D', className: 'git-status-deleted', title: 'Deleted' },
      C: { label: 'C', className: 'git-status-conflict', title: 'Conflict' },
      // Legacy support for raw git status codes (in case backend returns them)
      '??': { label: 'U', className: 'git-status-untracked', title: 'Untracked' },
    }

    const config = statusConfig[status]
    if (!config) return null

    return (
      <span className={`git-status-badge ${config.className}`} title={config.title}>
        {config.label}
      </span>
    )
  }

  const handleDragStart = (event, entry) => {
    event.dataTransfer.setData('text/plain', entry.path)
    event.dataTransfer.setData('application/x-kurt-file', JSON.stringify({
      path: entry.path,
      name: entry.name,
      is_dir: entry.is_dir,
    }))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event, entry) => {
    if (!entry.is_dir) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDragOver(entry.path)
  }

  const handleDragLeave = () => {
    setDragOver(null)
  }

  const handleDrop = async (event, destEntry) => {
    event.preventDefault()
    setDragOver(null)

    if (!destEntry.is_dir) return

    const fileData = event.dataTransfer.getData('application/x-kurt-file')
    if (!fileData) return

    const srcFile = JSON.parse(fileData)
    if (srcFile.path === destEntry.path) return
    // Don't allow dropping into self or parent
    if (destEntry.path.startsWith(srcFile.path + '/')) return

    try {
      const route = routes.files.move()
      const { response, data } = await apiFetchJson(route.path, {
        query: route.query,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src_path: srcFile.path, dest_dir: destEntry.path }),
      })
      if (response.ok) {
        await refreshTree()
        onFileMoved?.(srcFile.path, data.dest_path)
      } else {
        alert(`Failed to move: ${getHttpErrorDetail(response, data, 'Move failed')}`)
      }
    } catch (err) {
      alert(`Failed to move: ${err.message}`)
    }
  }

  const handleDropOnRoot = async (event) => {
    event.preventDefault()
    setDragOver(null)

    const fileData = event.dataTransfer.getData('application/x-kurt-file')
    if (!fileData) return

    const srcFile = JSON.parse(fileData)
    // Already in root
    if (!srcFile.path.includes('/')) return

    try {
      const route = routes.files.move()
      const { response, data } = await apiFetchJson(route.path, {
        query: route.query,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src_path: srcFile.path, dest_dir: '.' }),
      })
      if (response.ok) {
        await refreshTree()
        onFileMoved?.(srcFile.path, data.dest_path)
      } else {
        alert(`Failed to move: ${getHttpErrorDetail(response, data, 'Move failed')}`)
      }
    } catch (err) {
      alert(`Failed to move: ${err.message}`)
    }
  }

  const renderNewFileInput = (depth, parentDir) => {
    if (!newFileInput || newFileInput.parentDir !== parentDir) return null
    return (
      <div
        className="file-item file-item-new"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span className="file-item-icon">{getFileIcon(newFileInput.name || 'file')}</span>
        <input
          ref={newFileInputRef}
          type="text"
          className="rename-input"
          placeholder="filename"
          value={newFileInput.name}
          onChange={(ev) => setNewFileInput({ ...newFileInput, name: ev.target.value })}
          onKeyDown={handleNewFileKeyDown}
          onBlur={handleNewFileSubmit}
          onClick={(ev) => ev.stopPropagation()}
        />
      </div>
    )
  }

  const renderEntries = (items, depth = 0, _parentDir = '') => {
    return items.map((e) => {
      const fileStatus = e.is_dir ? null : getFileStatus(e.path)
      const dirHasChanges = e.is_dir && getDirStatus(e.path)
      const isRenaming = renaming?.entry.path === e.path
      const isDragOver = dragOver === e.path
      const isActive = !e.is_dir && activeFile === e.path

      return (
        <React.Fragment key={e.path}>
          <div
            className={`file-item ${dirHasChanges ? 'has-changes' : ''} ${isDragOver ? 'drag-over' : ''} ${isActive ? 'file-item-active' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => !isRenaming && handleClick(e)}
            onContextMenu={(event) => handleContextMenu(event, e)}
            draggable={!isRenaming}
            onDragStart={(event) => handleDragStart(event, e)}
            onDragOver={(event) => handleDragOver(event, e)}
            onDragLeave={handleDragLeave}
            onDrop={(event) => handleDrop(event, e)}
          >
            <span className="file-item-icon">
              {e.is_dir ? (expandedDirs[e.path] ? <FolderOpen size={14} /> : <Folder size={14} />) : getFileIcon(e.name)}
            </span>
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                className="rename-input"
                value={renaming.newName}
                onChange={(ev) => setRenaming({ ...renaming, newName: ev.target.value })}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleRenameSubmit}
                onClick={(ev) => ev.stopPropagation()}
              />
            ) : (
              <span className={`file-item-name ${fileStatus ? `file-name-${fileStatus.toLowerCase()}` : ''}`}>
                {e.name}
              </span>
            )}
            {renderStatusBadge(fileStatus)}
            {dirHasChanges && <span className="dir-changes-dot" title="Contains changes" />}
          </div>
          {e.is_dir && expandedDirs[e.path] && (
            <>
              {renderNewFileInput(depth + 1, e.path)}
              {renderEntries(expandedDirs[e.path], depth + 1, e.path)}
            </>
          )}
        </React.Fragment>
      )
    })
  }

  const highlightMatch = (text, query) => {
    if (!query.trim()) return text
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark>{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    )
  }

  const handleRootContextMenu = (event) => {
    // Only trigger if clicking on the tree container itself, not on file items
    if (event.target.closest('.file-item') || event.target.closest('.search-box')) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry: null, // null indicates root-level context menu
    })
  }

  const toggleSection = (sectionKey) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }))
  }

  // Organize entries into sections based on kurt config
  const organizeEntriesIntoSections = () => {
    if (!kurtConfig || entries.length === 0) {
      return null // Return null to use flat rendering
    }

    // Build section mapping: configKey -> path
    // Order: projects, sources (folders only)
    const sectionOrder = ['projects', 'sources']
    const sections = {}
    const usedPaths = new Set()

    for (const key of sectionOrder) {
      const path = kurtConfig[key]
      if (path) {
        sections[key] = {
          path,
          label: formatSectionLabel(path),
          icon: SECTION_ICONS[key] || Folder,
          entries: [],
        }
        usedPaths.add(path)
      }
    }

    // Categorize entries
    const otherEntries = []
    let configFile = null

    for (const entry of entries) {
      // Check if it's the kurt.config file
      if (entry.name === 'kurt.config' && !entry.is_dir) {
        configFile = entry
        continue
      }

      let matched = false
      for (const key of sectionOrder) {
        const sectionPath = kurtConfig[key]
        if (sectionPath && entry.path === sectionPath) {
          sections[key].entries.push(entry)
          matched = true
          break
        }
      }
      if (!matched) {
        otherEntries.push(entry)
      }
    }

    // Add "Other" section if there are unmatched entries
    if (otherEntries.length > 0) {
      sections.other = {
        path: null,
        label: 'Other',
        icon: MoreHorizontal,
        entries: otherEntries,
      }
    }

    return { sections, configFile }
  }

  const renderSection = (sectionKey, section) => {
    const isCollapsed = collapsedSections[sectionKey]
    const hasChanges = section.entries.some((e) =>
      e.is_dir ? getDirStatus(e.path) : getFileStatus(e.path)
    )

    return (
      <div key={sectionKey} className="file-tree-section">
        <div
          className={`file-tree-section-header ${hasChanges ? 'has-changes' : ''}`}
          onClick={() => toggleSection(sectionKey)}
        >
          <span className="section-collapse-icon">{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}</span>
          <span className="section-icon">{React.createElement(section.icon, { size: 14 })}</span>
          <span className="section-label">{section.label}</span>
          {hasChanges && <span className="dir-changes-dot" title="Contains changes" />}
        </div>
        {!isCollapsed && (
          <div className="file-tree-section-content">
            {sectionKey !== 'other' && section.path ? (
              // For main sections (projects, sources), render children directly from expandedDirs
              <>
                {renderNewFileInput(0, section.path)}
                {expandedDirs[section.path] !== undefined ? (
                  expandedDirs[section.path].length > 0 ? (
                    renderEntries(expandedDirs[section.path], 0, section.path)
                  ) : (
                    <div className="file-item section-empty-placeholder">
                      <span className="file-item-name">Empty</span>
                    </div>
                  )
                ) : (
                  <div
                    className="file-item section-folder-placeholder"
                    onClick={() => {
                      const entry = entries.find(e => e.path === section.path)
                      if (entry) handleClick(entry)
                    }}
                  >
                    <span className="file-item-icon"><FolderOpen size={14} /></span>
                    <span className="file-item-name">Loading...</span>
                  </div>
                )}
              </>
            ) : (
              // For "Other" section, render entries normally
              section.entries.map((entry) => (
                <React.Fragment key={entry.path}>
                  {renderEntries([entry], 0, '')}
                </React.Fragment>
              ))
            )}
          </div>
        )}
      </div>
    )
  }

  const organized = organizeEntriesIntoSections()
  const sections = organized?.sections
  const configFile = organized?.configFile

  return (
    <div className="file-tree" onContextMenu={handleRootContextMenu}>
      <div className="search-box">
        <Search className="search-icon" size={14} />
        <input
          type="text"
          className="search-input"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="search-clear"
            onClick={() => setSearchQuery('')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {trimmedQuery ? (
        <div className="search-results">
          {isSearching ? (
            <div className="search-status">Searching...</div>
          ) : searchResults.length === 0 ? (
            <div className="search-status">No files found</div>
          ) : (
            searchResults.map((result) => (
              <div
                key={result.path}
                className="search-result-item"
                onClick={() => handleSearchResultClick(result)}
              >
                <span className="search-result-icon">{getFileIcon(result.name)}</span>
                <div className="search-result-content">
                  <span className="search-result-name">
                    {highlightMatch(result.name, trimmedQuery)}
                    {renderStatusBadge(getFileStatus(result.path))}
                  </span>
                  <span className="search-result-path">{result.dir}</span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : sections ? (
        // Sectioned view when kurt config is available
        <div className="file-tree-sections">
          {/* New file input at root level */}
          {renderNewFileInput(0, '')}
          {/* Config file at top */}
          {configFile && (
            <div
              className={`file-item config-file-item ${activeFile === configFile.path ? 'file-item-active' : ''}`}
              onClick={() => onOpen(configFile.path)}
              onContextMenu={(event) => handleContextMenu(event, configFile)}
            >
              <span className="file-item-icon"><Settings size={14} /></span>
              <span className="file-item-name">{configFile.name}</span>
              {renderStatusBadge(getFileStatus(configFile.path))}
            </div>
          )}
          {/* Main sections: projects, sources - always show if path exists */}
          {['projects', 'sources'].map((key) =>
            sections[key] && sections[key].path
              ? renderSection(key, sections[key])
              : null
          )}
          {/* Other section (discrete) */}
          {sections.other && sections.other.entries.length > 0 && (
            renderSection('other', sections.other)
          )}
        </div>
      ) : (
        // Fallback flat view
        <>
          <h3
            className="file-tree-title"
            onDragOver={(e) => { e.preventDefault(); setDragOver('root') }}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDropOnRoot}
          >
            Project {dragOver === 'root' && <span className="drop-hint">(drop here)</span>}
          </h3>
          <div>
            {renderNewFileInput(0, '')}
            {renderEntries(entries)}
          </div>
        </>
      )}

      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Root-level context menu (no entry) */}
          {!contextMenu.entry ? (
            <>
              <div className="context-menu-item" onClick={() => handleNewFile('')}>
                New File
              </div>
              {projectRoot && (
                <>
                  <div className="context-menu-separator" />
                  <div className="context-menu-item" onClick={() => {
                    navigator.clipboard.writeText('.').catch(() => {})
                    setContextMenu(null)
                  }}>
                    Copy Relative Path
                  </div>
                  <div className="context-menu-item" onClick={() => {
                    navigator.clipboard.writeText(projectRoot).catch(() => {})
                    setContextMenu(null)
                  }}>
                    Copy Path
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {!contextMenu.entry.is_dir && (
                <>
                  <div className="context-menu-item" onClick={() => { onOpenToSide?.(contextMenu.entry.path); setContextMenu(null) }}>
                    Open to the Side
                  </div>
                  <div className="context-menu-separator" />
                </>
              )}
              <div className="context-menu-item" onClick={() => {
                // For folders: create inside folder. For files: create in same directory
                const parentDir = contextMenu.entry.is_dir
                  ? contextMenu.entry.path
                  : (contextMenu.entry.path.includes('/') ? contextMenu.entry.path.substring(0, contextMenu.entry.path.lastIndexOf('/')) : '')
                handleNewFile(parentDir)
              }}>
                New File
              </div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={() => handleCopyPath(false)}>
                Copy Relative Path
              </div>
              <div className="context-menu-item" onClick={() => handleCopyPath(true)}>
                Copy Path
              </div>
              <div className="context-menu-separator" />
              <div className="context-menu-item" onClick={handleRename}>
                Rename
              </div>
              <div className="context-menu-item context-menu-danger" onClick={handleDelete}>
                Delete
              </div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
