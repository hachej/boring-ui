import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Editor from '../components/Editor'
import CodeEditor from '../components/CodeEditor'
import GitDiff from '../components/GitDiff'
import {
  useFileContent,
  useFileWrite,
  useGitDiff,
  useGitShow,
  useGitStatus,
} from '../providers/data'

// Check if file is markdown
const isMarkdownFile = (filepath) => {
  if (!filepath) return false
  const ext = filepath.split('.').pop()?.toLowerCase()
  return ['md', 'markdown', 'mdx'].includes(ext)
}

export default function EditorPanel({ params: initialParams, api }) {
  // Track params updates from dockview
  const [params, setParams] = useState(initialParams || {})

  useEffect(() => {
    if (!api) return
    const disposable = api.onDidParametersChange((event) => {
      if (event.params) {
        setParams((prev) => ({ ...prev, ...event.params }))
      }
    })
    return () => disposable.dispose()
  }, [api])

  const {
    path,
    initialContent,
    contentVersion: initialVersion,
    onContentChange,
    onDirtyChange,
    initialMode,
  } = params || {}

  const [content, setContent] = useState(initialContent || '')
  const [savedContent, setSavedContent] = useState(initialContent || '')
  const [contentVersion, setContentVersion] = useState(initialVersion || 1)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [editorMode, setEditorMode] = useState(initialMode || 'rendered') // 'rendered' | 'diff' | 'git-diff'
  const [initialModeApplied, setInitialModeApplied] = useState(false)

  // Refs let query-driven polling compare against latest editor state.
  const contentRef = useRef(content)
  const pendingDiskSyncContentRef = useRef(null)
  const pendingDiskSyncDeadlineRef = useRef(0)

  // Keep refs in sync with state
  useEffect(() => { contentRef.current = content }, [content])
  const fileWriteMutation = useFileWrite()

  const { data: gitStatus } = useGitStatus()
  const gitAvailable = gitStatus?.available !== false

  const {
    data: diskContent,
    isSuccess: hasDiskContent,
    refetch: refetchDiskContent,
  } = useFileContent(path, {
    enabled: Boolean(path) && !isDirty && !isSaving,
    refetchInterval: path ? 2000 : false,
  })

  const {
    data: gitDiffText = '',
    error: gitDiffError,
    refetch: refetchGitDiff,
  } = useGitDiff(path, {
    enabled: Boolean(path) && gitAvailable && editorMode === 'git-diff',
  })

  const {
    data: gitShowContent,
    error: gitShowError,
    refetch: refetchGitShow,
  } = useGitShow(path, {
    enabled: Boolean(path) && gitAvailable && editorMode === 'diff',
  })

  const diffText = typeof gitDiffText === 'string' ? gitDiffText : ''
  const originalContent = typeof gitShowContent === 'string' ? gitShowContent : null
  const diffError = useMemo(() => {
    if (editorMode === 'git-diff') return gitDiffError?.message || ''
    if (editorMode === 'diff') return gitShowError?.message || ''
    return ''
  }, [editorMode, gitDiffError?.message, gitShowError?.message])

  // Apply initial mode when params change (e.g., opening from git changes)
  useEffect(() => {
    if (initialMode && !initialModeApplied) {
      if (initialMode === 'git-diff' && !gitAvailable) {
        setEditorMode('rendered')
      } else {
        setEditorMode(initialMode)
      }
      setInitialModeApplied(true)
    }
  }, [gitAvailable, initialMode, initialModeApplied])

  // Sync content from parent only when a newer external contentVersion arrives.
  // Avoid reapplying stale initialContent after local autosave.
  useEffect(() => {
    if (initialVersion === undefined) return
    if (isDirty || isSaving) return
    if (initialVersion <= contentVersion) return
    if (initialContent !== undefined && initialContent !== savedContent) {
      setContent(initialContent)
      setSavedContent(initialContent)
      setContentVersion(initialVersion)
    }
  }, [initialContent, initialVersion, savedContent, contentVersion, isDirty, isSaving])

  useEffect(() => {
    if (!path || !hasDiskContent || isDirty || isSaving) return
    const nextContent = typeof diskContent === 'string' ? diskContent : ''
    const pendingSavedContent = pendingDiskSyncContentRef.current
    if (pendingSavedContent !== null) {
      if (nextContent === pendingSavedContent) {
        pendingDiskSyncContentRef.current = null
        pendingDiskSyncDeadlineRef.current = 0
        setExternalChange(false)
        return
      }
      if (Date.now() < pendingDiskSyncDeadlineRef.current) {
        // Briefly suppress stale post-save reads until disk query catches up.
        return
      }
      pendingDiskSyncContentRef.current = null
      pendingDiskSyncDeadlineRef.current = 0
    }
    if (nextContent === contentRef.current) {
      setExternalChange(false)
      return
    }
    setExternalChange(true)
  }, [diskContent, hasDiskContent, isDirty, isSaving, path])

  useEffect(() => {
    if (!gitAvailable && editorMode === 'git-diff') {
      setEditorMode('rendered')
    }
  }, [editorMode, gitAvailable])

  const save = async (newContent) => {
    if (!path) return

    // Keep local editor state in sync while write mutation runs.
    // useFileWrite.onMutate cancels in-flight file read queries to prevent
    // stale poll responses from setting false external-change notifications.
    pendingDiskSyncContentRef.current = newContent
    pendingDiskSyncDeadlineRef.current = Date.now() + 3000
    setContent(newContent)
    setIsSaving(true)
    try {
      await fileWriteMutation.mutateAsync({ path, content: newContent })

      setSavedContent(newContent)
      setIsDirty(false)
      setExternalChange(false) // Clear notification since we just wrote to disk
      onContentChange?.(path, newContent)
      onDirtyChange?.(path, false)

      if (editorMode === 'git-diff') {
        await refetchGitDiff()
      } else if (editorMode === 'diff') {
        await refetchGitShow()
      }
    } catch (error) {
      pendingDiskSyncContentRef.current = null
      pendingDiskSyncDeadlineRef.current = 0
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (newContent) => {
    setContent(newContent)
    const dirty = newContent !== savedContent
    setIsDirty(dirty)
    onDirtyChange?.(path, dirty)
  }

  const handleAutoSave = (newContent) => {
    if (newContent === savedContent) return
    save(newContent)
  }

  const handleModeChange = (newMode) => {
    if (newMode === 'git-diff' && !gitAvailable) {
      return
    }
    setEditorMode(newMode)
  }

  const reloadFromDisk = useCallback(async () => {
    if (!path) return
    try {
      const result = await refetchDiskContent()
      const nextContent = typeof result?.data === 'string' ? result.data : ''
      setContent(nextContent)
      setSavedContent(nextContent)
      setIsDirty(false)
      onDirtyChange?.(path, false)
      setExternalChange(false)
      setContentVersion((v) => v + 1)

      if (editorMode === 'git-diff') {
        await refetchGitDiff()
      } else if (editorMode === 'diff') {
        await refetchGitShow()
      }
    } catch {
      // Keep current editor contents when reload fails.
    }
  }, [editorMode, onDirtyChange, path, refetchDiskContent, refetchGitDiff, refetchGitShow])

  // Only show folder path in breadcrumbs (filename is already in tab)
  const pathParts = path ? path.split('/').filter(Boolean) : []
  const breadcrumbs = pathParts.slice(0, -1) // Exclude filename
  const filename = pathParts[pathParts.length - 1] || ''

  // Determine if this is a markdown file
  const isMarkdown = useMemo(() => isMarkdownFile(path), [path])

  return (
    <div className="panel-content editor-panel-content">
      {externalChange && (
        <div className="notice">
          File changed on disk.
          <button type="button" onClick={reloadFromDisk}>
            Reload
          </button>
        </div>
      )}

      {breadcrumbs.length > 0 && (
        <div className="editor-breadcrumbs">
          {breadcrumbs.map((part, index) => {
            const isLast = index === breadcrumbs.length - 1
            return (
              <span key={`${part}-${index}`} className={`crumb${isLast ? ' crumb-current' : ''}`}>
                {part}
                {!isLast && <span className="crumb-sep">›</span>}
              </span>
            )
          })}
        </div>
      )}

      {isMarkdown ? (
        <Editor
          content={content}
          contentVersion={contentVersion}
          isDirty={isDirty}
          isSaving={isSaving}
          onChange={handleChange}
          onAutoSave={handleAutoSave}
          showDiffToggle={Boolean(path) && gitAvailable}
          editorMode={editorMode}
          diffText={diffText}
          diffError={diffError}
          originalContent={originalContent}
          onModeChange={handleModeChange}
        />
      ) : (
        <div className="code-viewer-container">
          {/* Mode selector for non-markdown files */}
          <div className="code-viewer-toolbar">
            <div className="editor-mode-selector">
              <button
                type="button"
                className={`mode-btn ${editorMode === 'rendered' ? 'active' : ''}`}
                onClick={() => handleModeChange('rendered')}
              >
                Code
              </button>
              {gitAvailable && (
                <button
                  type="button"
                  className={`mode-btn ${editorMode === 'git-diff' ? 'active' : ''}`}
                  onClick={() => handleModeChange('git-diff')}
                >
                  Diff
                </button>
              )}
            </div>
          </div>
          {editorMode === 'git-diff' ? (
            <div className="code-diff-view">
              {diffError && <div className="diff-error">{diffError}</div>}
              <GitDiff diff={diffText} showFileHeader={false} />
            </div>
          ) : (
            <CodeEditor
              content={content}
              contentVersion={contentVersion}
              filename={filename}
              isDirty={isDirty}
              isSaving={isSaving}
              onChange={handleChange}
              onAutoSave={handleAutoSave}
              className="editor-code-editor"
            />
          )}
        </div>
      )}
    </div>
  )
}
