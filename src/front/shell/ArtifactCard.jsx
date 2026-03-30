import React, { useCallback } from 'react'
import {
  ChevronRight,
  BarChart3,
  FileCode,
  FileText,
  Table2,
  Image,
  Globe,
  Code2,
  File,
} from 'lucide-react'

/**
 * Icon registry for artifact kinds.
 */
const KIND_ICONS = {
  chart: BarChart3,
  code: Code2,
  document: FileText,
  table: Table2,
  image: Image,
  web: Globe,
  file: FileCode,
}

function getArtifactIcon(iconName, kind) {
  // If explicit icon name matches a lucide icon, use it
  if (KIND_ICONS[iconName]) return KIND_ICONS[iconName]
  // Fall back to kind-based icon
  if (KIND_ICONS[kind]) return KIND_ICONS[kind]
  return File
}

/**
 * ArtifactCard - Clickable card representing an artifact in the chat timeline.
 * Three visual states: default, open, active.
 *
 * Props:
 *   artifact - { title, kind, icon }
 *   state    - 'default' | 'open' | 'active'
 *   onOpen   - (artifact) => void
 */
export default function ArtifactCard({ artifact, state = 'default', onOpen }) {
  const Icon = getArtifactIcon(artifact.icon, artifact.kind)

  const handleClick = useCallback(() => {
    if (onOpen) {
      onOpen(artifact)
    }
  }, [onOpen, artifact])

  const stateClass =
    state === 'active' ? ' active' : state === 'open' ? ' open' : ''

  return (
    <div
      className={`vc-artifact-card${stateClass}`}
      data-testid="artifact-card"
      onClick={handleClick}
    >
      <div className="vc-artifact-card-icon">
        <Icon size={16} />
      </div>
      <div className="vc-artifact-card-info">
        <span className="vc-artifact-card-title">{artifact.title}</span>
        <span className="vc-artifact-card-kind">{artifact.kind}</span>
      </div>
      <div className="vc-artifact-card-spacer" />
      <div className="vc-artifact-card-chevron" data-testid="artifact-chevron">
        <ChevronRight size={14} />
      </div>
    </div>
  )
}
