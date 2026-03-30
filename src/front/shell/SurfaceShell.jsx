import React, { useState, useCallback } from 'react'
import {
  PanelRightOpen,
  PanelRightClose,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  X,
  Sparkles,
} from 'lucide-react'

/**
 * SurfaceShell - Floating island container for artifacts.
 *
 * When `open` is false: display: none (NOT unmounted) -- preserves state.
 * When `collapsed`: shows 36px handle strip with artifact count.
 * When open: shows floating island with top bar (explorer toggle + tabs + close).
 *
 * Props:
 *   open              - boolean  whether surface is visible
 *   collapsed         - boolean  whether surface is in collapsed handle mode
 *   width             - number   surface width in pixels
 *   artifacts         - array    list of SurfaceArtifact objects
 *   activeArtifactId  - string|null  currently active artifact
 *   onClose           - () => void
 *   onCollapse        - () => void
 *   onResize          - (width: number) => void
 *   onSelectArtifact  - (id: string) => void
 *   onCloseArtifact   - (id: string) => void
 */
export default function SurfaceShell({
  open = false,
  collapsed = false,
  width = 620,
  artifacts = [],
  activeArtifactId = null,
  onClose,
  onCollapse,
  onResize,
  onSelectArtifact,
  onCloseArtifact,
}) {
  const [explorerOpen, setExplorerOpen] = useState(false)

  const handleResizeMouseDown = useCallback(
    (e) => {
      e.preventDefault()
      const sf = document.querySelector('.surface-shell')
      const startX = e.clientX
      const startW = sf?.offsetWidth || width
      const onMove = (ev) => {
        const newWidth = Math.max(380, Math.min(window.innerWidth * 0.65, startW + (startX - ev.clientX)))
        onResize(newWidth)
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [width, onResize]
  )

  // Collapsed handle mode
  if (collapsed) {
    return (
      <div
        className="sf-handle"
        data-testid="surface-shell-handle"
        onClick={onCollapse}
        title="Open Surface"
      >
        <PanelRightOpen size={14} />
        <span className="sf-handle-count" data-testid="surface-handle-count">
          {artifacts.length}
        </span>
      </div>
    )
  }

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId)

  return (
    <div
      className="surface-shell"
      data-testid="surface-shell"
      style={{
        display: open ? 'flex' : 'none',
        width: `${width}px`,
      }}
    >
      <div className="sf-resize" onMouseDown={handleResizeMouseDown} />

      <div className="sf-main">
        {/* Top bar: explorer toggle + tabs + close */}
        <div className="sf-topbar">
          <button
            className={`sf-explorer-toggle${explorerOpen ? ' active' : ''}`}
            onClick={() => setExplorerOpen((o) => !o)}
          >
            {explorerOpen ? (
              <ChevronDown size={12} style={{ transform: 'rotate(90deg)' }} />
            ) : (
              <ChevronRight size={12} />
            )}
            <FolderOpen size={13} />
            <span>Artifacts</span>
            {artifacts.length > 0 && (
              <span className="sf-explorer-toggle-count">{artifacts.length}</span>
            )}
          </button>

          <div className="sf-tabs">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                className={`sf-tab${artifact.id === activeArtifactId ? ' active' : ''}`}
                data-testid={`surface-tab-${artifact.id}`}
                onClick={() => onSelectArtifact(artifact.id)}
              >
                <span>{artifact.title}</span>
                <span
                  className="sf-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseArtifact(artifact.id)
                  }}
                >
                  <X size={10} />
                </span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <button
            className="sf-viewer-btn"
            data-testid="surface-close"
            onClick={onClose}
            title="Close Surface"
          >
            <PanelRightClose size={14} />
          </button>
        </div>

        {/* Viewer content */}
        <div className="sf-body">
          {!activeArtifact ? (
            <div className="sf-empty">
              <div className="sf-empty-icon">
                <Sparkles size={20} />
              </div>
              <div className="sf-empty-title">Select an artifact</div>
              <div className="sf-empty-sub">
                Ask the agent to analyze data, generate charts,
                review documents, or write code.
              </div>
            </div>
          ) : (
            <div className="sf-viewer">
              <div className="sf-viewer-head">
                <div className="sf-viewer-info">
                  <span className="sf-viewer-title">{activeArtifact.title}</span>
                  <span className="sf-viewer-type">{activeArtifact.kind}</span>
                </div>
              </div>
              <div className="sf-viewer-content">
                {/* Placeholder: full renderer integration comes in Phase 4 */}
                <div className="sf-viewer-placeholder">
                  Artifact viewer placeholder
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
