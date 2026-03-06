import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, ListChecks, Quote, Code, Link as LinkIcon,
  Minus, Highlighter, Loader2, Circle, Check,
  Table as TableIcon, Image as ImageIcon
} from 'lucide-react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import ImageResize from 'tiptap-extension-resize-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { Extension } from '@tiptap/core'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { diffLines, diffWords } from 'diff'
import GitDiff from './GitDiff'
import FrontmatterEditor, { parseFrontmatter, reconstructContent } from './FrontmatterEditor'
import { consumeInitialUpdateGuard } from './editorUpdateGuard'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

// Build a map of line changes with word-level diff info
function buildDiffMap(originalContent, currentContent) {
  // If content is identical, no changes
  if (originalContent === currentContent) {
    return { deletedLines: [], addedLineNumbers: new Set(), wordDiffs: new Map() }
  }

  // If no original content (new file), mark ALL lines as added
  if (!originalContent) {
    const lines = currentContent ? currentContent.split('\n') : []
    const addedLineNumbers = new Set()
    for (let i = 1; i <= lines.length; i++) {
      addedLineNumbers.add(i)
    }
    return { deletedLines: [], addedLineNumbers, wordDiffs: new Map() }
  }

  const changes = diffLines(originalContent, currentContent)
  const deletedLines = []
  const addedLineNumbers = new Set()
  const wordDiffs = new Map()

  let currentLineNum = 0
  let pendingDeleted = []
  let pendingDeletedTexts = []

  changes.forEach(change => {
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()

    if (change.removed) {
      lines.forEach(text => {
        pendingDeleted.push(text)
        pendingDeletedTexts.push(text)
      })
    } else if (change.added) {
      lines.forEach((text, idx) => {
        currentLineNum++
        addedLineNumbers.add(currentLineNum)

        if (idx < pendingDeletedTexts.length) {
          const oldText = pendingDeletedTexts[idx]
          const wordChanges = diffWords(oldText, text)
          wordDiffs.set(currentLineNum, wordChanges)
        }

        if (idx === 0 && pendingDeleted.length > 0) {
          const deletedWithWordDiffs = pendingDeleted.map((delText, delIdx) => {
            if (delIdx < lines.length) {
              return {
                text: delText,
                wordChanges: diffWords(delText, lines[delIdx])
              }
            }
            return { text: delText, wordChanges: null }
          })

          deletedLines.push({
            beforeLine: currentLineNum,
            texts: pendingDeleted,
            wordDiffs: deletedWithWordDiffs
          })
          pendingDeleted = []
          pendingDeletedTexts = []
        }
      })
    } else {
      if (pendingDeleted.length > 0) {
        deletedLines.push({
          beforeLine: currentLineNum + 1,
          texts: [...pendingDeleted],
          wordDiffs: pendingDeleted.map(t => ({ text: t, wordChanges: null }))
        })
        pendingDeleted = []
        pendingDeletedTexts = []
      }
      lines.forEach(() => {
        currentLineNum++
      })
    }
  })

  if (pendingDeleted.length > 0) {
    deletedLines.push({
      beforeLine: currentLineNum + 1,
      texts: [...pendingDeleted],
      wordDiffs: pendingDeleted.map(t => ({ text: t, wordChanges: null }))
    })
  }

  return { deletedLines, addedLineNumbers, wordDiffs }
}

// Create Tiptap extension for diff decorations
// Uses a ref to access the current diff state reactively
// Compares: originalContent (git HEAD) vs editor.getMarkdown() (current editor state)
// Both go through Tiptap's markdown serializer for consistent comparison
function createDiffExtension(diffStateRef) {
  return Extension.create({
    name: 'diffDecorations',

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('diffDecorations'),
          props: {
            decorations(state) {
              // Check if diff mode is enabled
              const { enabled, originalContent, getEditorMarkdown } = diffStateRef.current || {}
              if (!enabled) {
                return DecorationSet.empty
              }

              const doc = state.doc

              // Get current editor content as markdown
              const currentMarkdown = getEditorMarkdown ? getEditorMarkdown() : ''

              // Compare: git HEAD vs current editor markdown
              const diffMap = buildDiffMap(originalContent || '', currentMarkdown)
              const { deletedLines, addedLineNumbers, wordDiffs } = diffMap

              const decorations = []

              // Build a mapping from markdown lines to document nodes
              // Each block node in Tiptap corresponds to one or more markdown lines
              const currentLines = currentMarkdown.split('\n')
              let mdLineIndex = 0 // Current position in markdown lines

              doc.descendants((node, nodePos) => {
                if (!node.isBlock) return false

                // Skip nodes that don't produce markdown content
                if (node.type.name === 'doc') return true

                // Each block node typically produces 1 markdown line
                // Lists are an exception but we handle them by iterating child nodes
                let linesForNode = 1

                // Try to match node content to markdown lines
                // Skip empty lines in markdown that might be separators
                while (mdLineIndex < currentLines.length && currentLines[mdLineIndex] === '') {
                  mdLineIndex++
                }

                // Check if any of the lines for this node are marked as changed
                let nodeIsChanged = false
                const nodeWordDiffs = []

                for (let i = 0; i < linesForNode && (mdLineIndex + i) < currentLines.length; i++) {
                  const lineNum = mdLineIndex + i + 1 // 1-indexed
                  if (addedLineNumbers.has(lineNum)) {
                    nodeIsChanged = true
                    const wd = wordDiffs.get(lineNum)
                    if (wd) nodeWordDiffs.push(...wd)
                  }
                }

                // Apply decorations
                if (nodeIsChanged) {
                  decorations.push(
                    Decoration.node(nodePos, nodePos + node.nodeSize, {
                      class: 'diff-line-added'
                    })
                  )

                  // Word-level highlights
                  if (nodeWordDiffs.length > 0 && node.isTextblock) {
                    let textOffset = 0
                    const textStart = nodePos + 1

                    nodeWordDiffs.forEach(part => {
                      if (part.added) {
                        const from = textStart + textOffset
                        const to = from + part.value.length
                        if (to <= nodePos + node.nodeSize - 1) {
                          decorations.push(
                            Decoration.inline(from, to, {
                              class: 'diff-word-added'
                            })
                          )
                        }
                        textOffset += part.value.length
                      } else if (!part.removed) {
                        textOffset += part.value.length
                      }
                    })
                  }
                }

                // Check for deleted lines before this node
                const lineNum = mdLineIndex + 1
                const deletedBefore = deletedLines.find(d => d.beforeLine === lineNum)
                if (deletedBefore) {
                  const widget = document.createElement('div')
                  widget.className = 'diff-deleted-block'
                  widget.contentEditable = 'false'

                  const deletedTexts = []

                  if (deletedBefore.wordDiffs) {
                    deletedBefore.wordDiffs.forEach(({ text, wordChanges }) => {
                      const lineDiv = document.createElement('div')
                      lineDiv.className = 'diff-deleted-line'
                      deletedTexts.push(text)

                      if (wordChanges) {
                        wordChanges.forEach(part => {
                          const span = document.createElement('span')
                          if (part.removed) {
                            span.className = 'diff-word-removed'
                            span.textContent = part.value
                            lineDiv.appendChild(span)
                          } else if (!part.added) {
                            span.textContent = part.value
                            lineDiv.appendChild(span)
                          }
                        })
                      } else {
                        lineDiv.textContent = text || '\u00A0'
                      }

                      widget.appendChild(lineDiv)
                    })
                  } else {
                    deletedBefore.texts.forEach(text => {
                      const lineDiv = document.createElement('div')
                      lineDiv.className = 'diff-deleted-line'
                      lineDiv.textContent = text || '\u00A0'
                      deletedTexts.push(text)
                      widget.appendChild(lineDiv)
                    })
                  }

                  // Keep this control text-only so the app's iconography remains Lucide-only.
                  const copyBtn = document.createElement('button')
                  copyBtn.className = 'diff-copy-btn'
                  copyBtn.innerHTML = '<span>Copy</span>'
                  copyBtn.title = 'Copy deleted text'
                  copyBtn.onclick = (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigator.clipboard.writeText(deletedTexts.join('\n'))
                    copyBtn.innerHTML = '<span>Copied</span>'
                    setTimeout(() => { copyBtn.innerHTML = '<span>Copy</span>' }, 1500)
                  }
                  widget.appendChild(copyBtn)

                  decorations.push(
                    Decoration.widget(nodePos, widget, { side: -1 })
                  )
                }

                mdLineIndex += linesForNode
                return false
              })

              // Trailing deletions (at end of document)
              const lastLineNum = currentLines.length + 1
              const trailingDeleted = deletedLines.find(d => d.beforeLine >= lastLineNum)
              if (trailingDeleted) {
                const widget = document.createElement('div')
                widget.className = 'diff-deleted-block'
                trailingDeleted.texts.forEach(text => {
                  const lineDiv = document.createElement('div')
                  lineDiv.className = 'diff-deleted-line'
                  lineDiv.textContent = text || '\u00A0'
                  widget.appendChild(lineDiv)
                })
                decorations.push(
                  Decoration.widget(doc.content.size, widget, { side: 1 })
                )
              }

              return DecorationSet.create(doc, decorations)
            }
          }
        })
      ]
    }
  })
}

function MenuBar({ editor }) {
  const setLink = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const insertTable = useCallback(() => {
    if (!editor) return
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }, [editor])

  const insertImage = useCallback(() => {
    if (!editor) return
    const url = window.prompt('Image URL')
    if (url) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="editor-menu">
      <div className="menu-group">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
          title="Bold (Ctrl+B)"
        >
          <Bold size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
          title="Italic (Ctrl+I)"
        >
          <Italic size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={editor.isActive('underline') ? 'is-active' : ''}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
          title="Strikethrough"
        >
          <Strikethrough size={16} />
        </button>
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
          title="Heading 1"
        >
          <span className="text-btn">H1</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
          title="Heading 2"
        >
          <span className="text-btn">H2</span>
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
          title="Heading 3"
        >
          <span className="text-btn">H3</span>
        </button>
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'is-active' : ''}
          title="Bullet List"
        >
          <List size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'is-active' : ''}
          title="Numbered List"
        >
          <ListOrdered size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          className={editor.isActive('taskList') ? 'is-active' : ''}
          title="Task List"
        >
          <ListChecks size={16} />
        </button>
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive('blockquote') ? 'is-active' : ''}
          title="Quote"
        >
          <Quote size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={editor.isActive('codeBlock') ? 'is-active' : ''}
          title="Code Block"
        >
          <Code size={16} />
        </button>
        <button
          type="button"
          onClick={setLink}
          className={editor.isActive('link') ? 'is-active' : ''}
          title="Add Link"
        >
          <LinkIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus size={16} />
        </button>
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className={editor.isActive('highlight') ? 'is-active' : ''}
          title="Highlight"
        >
          <Highlighter size={16} />
        </button>
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <button
          type="button"
          onClick={insertTable}
          title="Insert Table"
        >
          <TableIcon size={16} />
        </button>
        <button
          type="button"
          onClick={insertImage}
          title="Insert Image"
        >
          <ImageIcon size={16} />
        </button>
      </div>
    </div>
  )
}

function SaveStatus({ isDirty, isSaving }) {
  if (isSaving) {
    return (
      <div className="save-status save-status-saving" title="Saving...">
        <Loader2 size={16} className="save-spinner" />
      </div>
    )
  }

  if (isDirty) {
    return (
      <div className="save-status save-status-dirty" title="Unsaved changes">
        <Circle size={16} fill="currentColor" />
      </div>
    )
  }

  return (
    <div className="save-status save-status-saved" title="All changes saved">
      <Check size={16} />
    </div>
  )
}

// Editor modes: 'rendered' (default Tiptap), 'diff' (inline diff editing), 'git-diff' (legacy read-only diff)
export default function Editor({
  content,
  contentVersion,
  isDirty,
  isSaving,
  onChange,
  onAutoSave,
  autoSaveDelay = 800,
  showDiffToggle = false,
  diffText = '',
  diffError = '',
  // Props for inline diff mode
  editorMode = 'rendered', // 'rendered' | 'diff' | 'git-diff'
  originalContent = null,
  onModeChange,
}) {
  const autoSaveTimer = useRef(null)
  const diffStateRef = useRef({ enabled: false, originalContent: null })

  // Frontmatter state - separate from body content
  // Parse initial values from content prop
  const initialParsed = useMemo(() => parseFrontmatter(content || ''), [content])
  const [frontmatterCollapsed, setFrontmatterCollapsed] = useState(
    !initialParsed.frontmatter || initialParsed.frontmatter.trim() === ''
  )
  const [currentFrontmatter, setCurrentFrontmatter] = useState(initialParsed.frontmatter)
  const [currentBody, setCurrentBody] = useState(initialParsed.body)
  const lastContentVersionRef = useRef(contentVersion)

  // Ref to access latest frontmatter in callbacks without stale closures
  const currentFrontmatterRef = useRef(initialParsed.frontmatter)
  currentFrontmatterRef.current = currentFrontmatter

  // Refs for callbacks to avoid stale closures in TipTap's onUpdate
  // Without these, callbacks captured at editor creation time would be stale
  // after layout restoration when params are updated with new callbacks
  const onChangeRef = useRef(onChange)
  const onAutoSaveRef = useRef(onAutoSave)
  const ignoreNextEditorUpdateRef = useRef(true)
  onChangeRef.current = onChange
  onAutoSaveRef.current = onAutoSave

  // Re-parse content only when contentVersion changes (external file reload)
  // NOT when content changes from typing (that would cause loops)
  useEffect(() => {
    // Skip if contentVersion hasn't changed
    if (contentVersion === lastContentVersionRef.current) return
    lastContentVersionRef.current = contentVersion

    const { frontmatter, body } = parseFrontmatter(content || '')
    setCurrentFrontmatter(frontmatter)
    setCurrentBody(body)
    // Auto-expand if there's frontmatter, collapse if not
    setFrontmatterCollapsed(!frontmatter || frontmatter.trim() === '')
  }, [content, contentVersion])

  // Clear initial guard quickly so the first real user edit is never ignored
  // in cases where the editor emits no initialization update event.
  useEffect(() => {
    const timer = setTimeout(() => {
      ignoreNextEditorUpdateRef.current = false
    }, 0)
    return () => clearTimeout(timer)
  }, [])

  // Base extensions used for both the editor and for normalizing original content
  // This ensures both sides go through the exact same Tiptap schema
  const baseExtensions = useMemo(
    () => [
      StarterKit.configure({
        // Disable default codeBlock, we use CodeBlockLowlight for syntax highlighting
        codeBlock: false,
        // Disable extensions we configure separately to avoid duplicate extension warnings
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'editor-link',
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight,
      // ImageResize extension: supports paste, drag-drop, and resize handles
      ImageResize.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'editor-table',
        },
      }),
      TableRow,
      TableCell,
      TableHeader,
      // CodeBlockLowlight for syntax highlighting
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'editor-code-block',
        },
      }),
      // Official Tiptap Markdown extension for bidirectional markdown support
      Markdown.configure({
        // Preserve line breaks as <br> tags
        markedOptions: {
          breaks: true,
          gfm: true,
        },
      }),
    ],
    []
  )

  // Create diff extension once, it uses the ref to check state
  const DiffExtension = useMemo(() => {
    return createDiffExtension(diffStateRef)
  }, [])

  // Handle frontmatter changes
  // Uses refs for callbacks to avoid stale closures after layout restore
  const handleFrontmatterChange = useCallback((newFrontmatter) => {
    setCurrentFrontmatter(newFrontmatter)
    const fullContent = reconstructContent(newFrontmatter, currentBody)

    if (onChangeRef.current) {
      onChangeRef.current(fullContent)
    }

    if (onAutoSaveRef.current) {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
      autoSaveTimer.current = setTimeout(() => {
        const latestFullContent = reconstructContent(newFrontmatter, currentBody)
        onAutoSaveRef.current?.(latestFullContent)
      }, autoSaveDelay)
    }
  }, [currentBody, autoSaveDelay])

  const editor = useEditor({
    extensions: [...baseExtensions, DiffExtension],
    // Use contentType: 'markdown' to parse initial content as markdown
    // Start with body only (frontmatter handled separately)
    // Use initialParsed.body which is computed once on mount
    content: initialParsed.body || '',
    contentType: 'markdown',
    onUpdate: ({ editor: editorInstance }) => {
      // Use editor.getMarkdown() from @tiptap/markdown
      const bodyMarkdown = editorInstance.getMarkdown()
      setCurrentBody(bodyMarkdown)
      if (consumeInitialUpdateGuard(ignoreNextEditorUpdateRef)) return
      // Use refs to get latest values (avoids stale closures after layout restore)
      const fullContent = reconstructContent(currentFrontmatterRef.current, bodyMarkdown)

      if (onChangeRef.current) {
        onChangeRef.current(fullContent)
      }

      if (onAutoSaveRef.current) {
        if (autoSaveTimer.current) {
          clearTimeout(autoSaveTimer.current)
        }
        // Use a callback to get the latest content when the timer fires
        autoSaveTimer.current = setTimeout(() => {
          // Get fresh markdown at save time, not when update was triggered
          const latestBodyMarkdown = editorInstance.getMarkdown()
          const latestFullContent = reconstructContent(currentFrontmatterRef.current, latestBodyMarkdown)
          onAutoSaveRef.current?.(latestFullContent)
        }, autoSaveDelay)
      }
    },
  })

  // Update diff state when mode or original content changes
  // For diff comparison, we use editor.getMarkdown() to get normalized output
  // This ensures both sides go through the same Tiptap markdown serializer
  useEffect(() => {
    const wasEnabled = diffStateRef.current.enabled
    const isEnabled = editorMode === 'diff' && originalContent !== null

    diffStateRef.current = {
      enabled: isEnabled,
      originalContent: originalContent,
      // getCurrentMarkdown will be called by the plugin to get fresh editor content
      getEditorMarkdown: () => editor?.getMarkdown() || '',
    }

    // Force editor to re-render decorations
    if (editor && (wasEnabled !== isEnabled || isEnabled)) {
      // Trigger a view update to recalculate decorations
      editor.view.dispatch(editor.state.tr)
    }
  }, [editorMode, originalContent, editor])

  // Only reset editor content when contentVersion changes (external file reload)
  // NOT when currentBody changes (which happens during typing/autosave)
  // Parse directly from content prop to avoid race conditions with state updates
  useEffect(() => {
    if (!editor) return
    if (contentVersion === undefined) return
    // Parse body directly from content prop (not state) to ensure we have latest value
    const { body } = parseFrontmatter(content || '')
    ignoreNextEditorUpdateRef.current = true
    editor.commands.setContent(body || '', { contentType: 'markdown' })
    const timer = setTimeout(() => {
      ignoreNextEditorUpdateRef.current = false
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentVersion, editor])

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
  }, [])

  const handleDrop = useCallback((event) => {
    const fileData = event.dataTransfer.getData('application/x-kurt-file')
    if (fileData && editor) {
      event.preventDefault()
      try {
        const file = JSON.parse(fileData)
        if (file.path) {
          const linkText = file.name || file.path.split('/').pop()
          editor.chain().focus().insertContent(`[${linkText}](${file.path})`).run()
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, [editor])

  const handleDragOver = useCallback((event) => {
    if (event.dataTransfer.types.includes('application/x-kurt-file')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  // Mode selector for when diff is available
  const renderModeSelector = () => {
    if (!showDiffToggle) return null

    return (
      <div className="editor-mode-selector">
        <button
          type="button"
          className={`mode-btn${editorMode === 'rendered' ? ' active' : ''}`}
          onClick={() => onModeChange?.('rendered')}
          title="Edit rendered content"
        >
          Edit
        </button>
        <button
          type="button"
          className={`mode-btn${editorMode === 'diff' ? ' active' : ''}`}
          onClick={() => onModeChange?.('diff')}
          title="Edit with inline diff highlighting"
        >
          Diff
        </button>
        <button
          type="button"
          className={`mode-btn${editorMode === 'git-diff' ? ' active' : ''}`}
          onClick={() => onModeChange?.('git-diff')}
          title="View git diff (read-only)"
        >
          Raw
        </button>
      </div>
    )
  }

  // Render the appropriate content based on mode
  const renderContent = () => {
    if (editorMode === 'git-diff') {
      return (
        <>
          {diffError && <div className="diff-error">{diffError}</div>}
          <GitDiff diff={diffText} showFileHeader={false} />
        </>
      )
    }

    // Both 'rendered' and 'diff' modes use the same editor
    // The diff decorations are applied via the plugin when in diff mode
    if (editorMode === 'diff' && diffError) {
      return <div className="diff-error">{diffError}</div>
    }
    if (editorMode === 'diff' && originalContent === null) {
      return <div className="diff-loading">Loading original content...</div>
    }

    return <EditorContent editor={editor} />
  }

  return (
    <div className="editor-wrapper">
      <div className="editor-toolbar">
        <MenuBar editor={editor} />
        <div className="editor-toolbar-right">
          {editorMode !== 'git-diff' && <SaveStatus isDirty={isDirty} isSaving={isSaving} />}
          {renderModeSelector()}
        </div>
      </div>

      {/* Frontmatter editor - only show in edit modes, not git-diff */}
      {editorMode !== 'git-diff' && (
        <FrontmatterEditor
          frontmatter={currentFrontmatter}
          onChange={handleFrontmatterChange}
          isCollapsed={frontmatterCollapsed}
          onToggleCollapse={() => setFrontmatterCollapsed(!frontmatterCollapsed)}
          isDiffMode={editorMode === 'diff'}
          originalFrontmatter={originalContent ? parseFrontmatter(originalContent).frontmatter : null}
        />
      )}

      <div
        className="editor-content"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {renderContent()}
      </div>
    </div>
  )
}
