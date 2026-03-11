import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Code as CodeIcon, FileCode2, ChevronDown } from 'lucide-react'
import Editor from '../components/Editor'
import PotionEditor from '../components/PotionEditor'
import CodeEditor from '../components/CodeEditor'
import GitDiff from '../components/GitDiff'
import {
  useFileContent,
  useFileWrite,
  useGitDiff,
  useGitShow,
  useGitStatus,
} from '../providers/data'
import { isMarkdownFile } from '../utils/editorFiles'

const codeModeOptions = [
  { key: 'rendered', label: 'Code', icon: CodeIcon, desc: 'Edit code' },
  { key: 'git-diff', label: 'Patch', icon: FileCode2, desc: 'Git unified diff' },
]

function CodeModeDropdown({ editorMode, gitAvailable, onModeChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!gitAvailable) return null

  const current = codeModeOptions.find((m) => m.key === editorMode) || codeModeOptions[0]

  return (
    <div className="code-viewer-toolbar">
      <div className="editor-mode-dropdown" ref={ref}>
        <button
          type="button"
          className="editor-mode-trigger"
          onClick={() => setOpen(!open)}
          title={current.desc}
        >
          <current.icon size={13} />
          <span>{current.label}</span>
          <ChevronDown size={10} className={`editor-mode-chevron${open ? ' open' : ''}`} />
        </button>
        {open && (
          <div className="editor-mode-menu" role="menu">
            {codeModeOptions.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`editor-mode-option${editorMode === opt.key ? ' active' : ''}`}
                role="menuitem"
                onClick={() => { onModeChange(opt.key); setOpen(false) }}
              >
                <opt.icon size={13} />
                <span className="editor-mode-option-label">{opt.label}</span>
                <span className="editor-mode-option-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
    markdownEditor = 'tiptap',
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
    isLoading: isDiskContentLoading,
    isFetching: isDiskContentFetching,
    isSuccess: hasDiskContent,
    error: diskContentError,
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
    // Auto-sync external disk changes when editor buffer is clean.
    setContent(nextContent)
    setSavedContent(nextContent)
    setIsDirty(false)
    onDirtyChange?.(path, false)
    setExternalChange(false)
    setContentVersion((v) => v + 1)

    if (editorMode === 'git-diff') {
      refetchGitDiff()
    } else if (editorMode === 'diff') {
      refetchGitShow()
    }
  }, [
    diskContent,
    editorMode,
    hasDiskContent,
    isDirty,
    isSaving,
    onDirtyChange,
    path,
    refetchGitDiff,
    refetchGitShow,
  ])

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
  const showFileLoadingState = Boolean(path) && !hasDiskContent && (isDiskContentLoading || isDiskContentFetching) && !content
  const showFileErrorState = Boolean(path) && !hasDiskContent && Boolean(diskContentError) && !content

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

      {showFileErrorState ? (
        <div className="editor-loading-state editor-loading-error" role="alert">
          <div className="editor-loading-title">Could not load file</div>
          <div className="editor-loading-detail">{diskContentError.message || String(diskContentError)}</div>
          <button
            type="button"
            className="editor-loading-retry"
            onClick={() => refetchDiskContent()}
          >
            Retry
          </button>
        </div>
      ) : showFileLoadingState ? (
        <div className="editor-loading-state" role="status" aria-live="polite">
          <div className="editor-loading-progress" />
          <div className="editor-loading-skeleton">
            <div className="editor-loading-line w-80" />
            <div className="editor-loading-line w-65" />
            <div className="editor-loading-line w-75" />
            <div className="editor-loading-line w-58" />
            <div className="editor-loading-line w-70" />
          </div>
        </div>
      ) : isMarkdown ? (
        markdownEditor === 'potion' ? (
          <PotionEditor
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
        )
      ) : (
        <div className="code-viewer-container">
          {/* Mode dropdown for non-markdown files */}
          <CodeModeDropdown
            editorMode={editorMode}
            gitAvailable={gitAvailable}
            onModeChange={handleModeChange}
          />
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
