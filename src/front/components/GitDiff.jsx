import React from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import { CircleAlert, Command, GitCompareArrows, SearchX } from 'lucide-react'
import 'react-diff-view/style/index.css'

function DiffEmptyState({ icon: Icon, title, message, tone = 'normal' }) {
  return (
    <div className={`diff-empty empty-state ${tone === 'error' ? 'diff-empty-error' : ''}`}>
      <span className="empty-state-icon-wrap diff-empty-icon-wrap" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className="empty-state-title diff-empty-title">{title}</div>
      <div className="empty-state-message diff-empty-message">{message}</div>
      <div className="empty-state-hint diff-empty-hint">
        <Command size={14} aria-hidden="true" />
        <span>Select another file with changes from Source Control.</span>
      </div>
    </div>
  )
}

export default function GitDiff({ diff, showFileHeader = true, viewType = 'split' }) {
  if (!diff) {
    return (
      <DiffEmptyState
        icon={SearchX}
        title="No changes for this file"
        message="This file has no staged or unstaged hunks to preview."
      />
    )
  }

  let files = []
  try {
    files = parseDiff(diff)
  } catch {
    return (
      <DiffEmptyState
        icon={CircleAlert}
        title="Diff preview unavailable"
        message="The diff payload could not be parsed."
        tone="error"
      />
    )
  }
  if (!files.length) {
    return (
      <DiffEmptyState
        icon={GitCompareArrows}
        title="No hunks to display"
        message="Git returned an empty diff for the selected file."
      />
    )
  }

  return (
    <div className="diff-content">
      {files.map((file) => (
        <div key={`${file.oldPath}-${file.newPath}`} className="diff-file">
          {showFileHeader && <div className="diff-file-header">{file.newPath}</div>}
          <Diff viewType={viewType} diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      ))}
    </div>
  )
}
