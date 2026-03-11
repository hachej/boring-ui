import { useEffect, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Loader2,
  Circle,
  Check,
} from 'lucide-react'
import { MarkdownPlugin } from '@platejs/markdown'
import {
  BlockquotePlugin,
  BoldPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react'
import { CodeBlockPlugin } from '@platejs/code-block/react'
import { LinkPlugin } from '@platejs/link/react'
import { ListPlugin } from '@platejs/list/react'
import { toggleList } from '@platejs/list'
import { upsertLink } from '@platejs/link'
import { KEYS } from 'platejs'
import {
  ParagraphPlugin,
  Plate,
  PlateContent,
  useEditorRef,
  useEditorSelector,
  useMarkToolbarButton,
  useMarkToolbarButtonState,
  usePlateEditor,
} from 'platejs/react'
import remarkGfm from 'remark-gfm'
import GitDiff from './GitDiff'
import FrontmatterEditor, { parseFrontmatter, reconstructContent } from './FrontmatterEditor'

export const EMPTY_POTION_VALUE = [{ type: KEYS.p, children: [{ text: '' }] }]

export const potionPlugins = [
  ParagraphPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  BlockquotePlugin,
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodeBlockPlugin,
  LinkPlugin,
  ListPlugin.configure({
    inject: {
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.blockquote, KEYS.codeBlock],
    },
  }),
  MarkdownPlugin.configure({
    options: {
      remarkPlugins: [remarkGfm],
    },
  }),
]

function deserializeMarkdown(editor, markdown) {
  const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(markdown || '')
  return Array.isArray(nodes) && nodes.length > 0 ? nodes : EMPTY_POTION_VALUE
}

function getCurrentBlockType(block) {
  if (!block) return KEYS.p
  if (block[KEYS.listType]) {
    if (block[KEYS.listType] === KEYS.ol) return KEYS.ol
    if (block[KEYS.listType] === KEYS.listTodo) return KEYS.listTodo
    return KEYS.ul
  }
  return block.type || KEYS.p
}

function setBlockType(editor, type) {
  if (type === KEYS.ul || type === KEYS.ol) {
    toggleList(editor, { listStyleType: type })
    editor.tf.focus()
    return
  }

  const entries = editor.api.blocks({ mode: 'lowest' })

  editor.tf.withoutNormalizing(() => {
    entries.forEach((entry) => {
      const [node, path] = entry

      if (node[KEYS.listType]) {
        editor.tf.unsetNodes([KEYS.listType, 'indent', KEYS.listChecked], { at: path })
      }

      if (node.type !== type) {
        editor.tf.setNodes({ type }, { at: path })
      }
    })
  })

  editor.tf.focus()
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

function MarkButton({ icon: Icon, nodeType, title }) {
  const editor = useEditorRef()
  const state = useMarkToolbarButtonState({ nodeType })
  const { props } = useMarkToolbarButton(state)
  const { onClick, ...buttonProps } = props

  return (
    <button
      {...buttonProps}
      type="button"
      title={title}
      className={state.pressed ? 'is-active' : ''}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        onClick?.(event)
        editor.tf.focus()
      }}
    >
      <Icon size={16} />
    </button>
  )
}

function BlockButton({ icon: Icon, isActive, onClick, title, label }) {
  return (
    <button
      type="button"
      title={title}
      className={isActive ? 'is-active' : ''}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {Icon ? <Icon size={16} /> : <span className="text-btn">{label}</span>}
    </button>
  )
}

function PotionToolbar() {
  const editor = useEditorRef()
  const activeBlockType = useEditorSelector((currentEditor) => {
    const block = currentEditor.api.block()?.[0]
    return getCurrentBlockType(block)
  })

  const insertLink = () => {
    const url = window.prompt('URL')
    if (!url) return

    const selectedText = editor.selection ? editor.api.string(editor.selection) : ''
    upsertLink(editor, {
      skipValidation: true,
      target: url.startsWith('http://') || url.startsWith('https://') ? '_blank' : undefined,
      text: selectedText || undefined,
      url,
    })
    editor.tf.focus()
  }

  return (
    <div className="editor-menu">
      <div className="menu-group">
        <MarkButton icon={Bold} nodeType={KEYS.bold} title="Bold (Ctrl+B)" />
        <MarkButton icon={Italic} nodeType={KEYS.italic} title="Italic (Ctrl+I)" />
        <MarkButton icon={UnderlineIcon} nodeType={KEYS.underline} title="Underline (Ctrl+U)" />
        <MarkButton icon={Strikethrough} nodeType={KEYS.strikethrough} title="Strikethrough" />
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <BlockButton
          isActive={activeBlockType === KEYS.h1}
          label="H1"
          onClick={() => setBlockType(editor, KEYS.h1)}
          title="Heading 1"
        />
        <BlockButton
          isActive={activeBlockType === KEYS.h2}
          label="H2"
          onClick={() => setBlockType(editor, KEYS.h2)}
          title="Heading 2"
        />
        <BlockButton
          isActive={activeBlockType === KEYS.h3}
          label="H3"
          onClick={() => setBlockType(editor, KEYS.h3)}
          title="Heading 3"
        />
      </div>

      <div className="menu-separator" />

      <div className="menu-group">
        <BlockButton
          icon={List}
          isActive={activeBlockType === KEYS.ul}
          onClick={() => setBlockType(editor, KEYS.ul)}
          title="Bullet List"
        />
        <BlockButton
          icon={ListOrdered}
          isActive={activeBlockType === KEYS.ol}
          onClick={() => setBlockType(editor, KEYS.ol)}
          title="Numbered List"
        />
        <BlockButton
          icon={Quote}
          isActive={activeBlockType === KEYS.blockquote}
          onClick={() => setBlockType(editor, KEYS.blockquote)}
          title="Quote"
        />
        <BlockButton
          icon={Code}
          isActive={activeBlockType === KEYS.codeBlock}
          onClick={() => setBlockType(editor, KEYS.codeBlock)}
          title="Code Block"
        />
        <BlockButton
          icon={LinkIcon}
          isActive={false}
          onClick={insertLink}
          title="Insert Link"
        />
      </div>
    </div>
  )
}

export default function PotionEditor({
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
  editorMode = 'rendered',
  originalContent = null,
  onModeChange,
  onEditorReady,
}) {
  const autoSaveTimer = useRef(null)
  const lastContentVersionRef = useRef(null)
  const currentFrontmatterRef = useRef('')
  const ignoreNextValueChangeRef = useRef(false)

  const initialParsed = parseFrontmatter(content || '')
  const [frontmatterCollapsed, setFrontmatterCollapsed] = useState(
    !initialParsed.frontmatter || initialParsed.frontmatter.trim() === ''
  )
  const [currentFrontmatter, setCurrentFrontmatter] = useState(initialParsed.frontmatter)
  const [currentBody, setCurrentBody] = useState(initialParsed.body)

  useEffect(() => {
    currentFrontmatterRef.current = currentFrontmatter
  }, [currentFrontmatter])

  const editor = usePlateEditor({
    plugins: potionPlugins,
    value: EMPTY_POTION_VALUE,
  })

  useEffect(() => {
    onEditorReady?.(editor)
  }, [editor, onEditorReady])

  useEffect(() => {
    if (!editor) return
    if (contentVersion === lastContentVersionRef.current) return

    lastContentVersionRef.current = contentVersion
    const { frontmatter, body } = parseFrontmatter(content || '')
    const nextValue = deserializeMarkdown(editor, body)

    setCurrentFrontmatter(frontmatter)
    setCurrentBody(body)
    setFrontmatterCollapsed(!frontmatter || frontmatter.trim() === '')

    ignoreNextValueChangeRef.current = true
    editor.tf.replaceNodes(nextValue, {
      at: [],
      children: true,
    })
  }, [content, contentVersion, editor])

  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
  }, [])

  const handleFrontmatterChange = (newFrontmatter) => {
    setCurrentFrontmatter(newFrontmatter)
    const fullContent = reconstructContent(newFrontmatter, currentBody)
    onChange?.(fullContent)

    if (onAutoSave) {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
      autoSaveTimer.current = setTimeout(() => {
        onAutoSave(reconstructContent(newFrontmatter, currentBody))
      }, autoSaveDelay)
    }
  }

  const handleDrop = (event) => {
    const fileData = event.dataTransfer.getData('application/x-kurt-file')
    if (!fileData || !editor) return

    event.preventDefault()

    try {
      const file = JSON.parse(fileData)
      if (!file.path) return

      const linkText = file.name || file.path.split('/').pop()
      upsertLink(editor, {
        skipValidation: true,
        text: linkText,
        url: file.path,
      })
      editor.tf.focus()
    } catch {
      // Ignore invalid drag payloads.
    }
  }

  const handleDragOver = (event) => {
    if (event.dataTransfer.types.includes('application/x-kurt-file')) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const effectiveMode = editorMode === 'git-diff' ? 'git-diff' : 'rendered'

  return (
    <Plate
      editor={editor}
      onValueChange={({ editor: plateEditor }) => {
        if (ignoreNextValueChangeRef.current) {
          ignoreNextValueChangeRef.current = false
          return
        }

        const bodyMarkdown = plateEditor.getApi(MarkdownPlugin).markdown.serialize()
        setCurrentBody(bodyMarkdown)

        const fullContent = reconstructContent(currentFrontmatterRef.current, bodyMarkdown)
        onChange?.(fullContent)

        if (onAutoSave) {
          if (autoSaveTimer.current) {
            clearTimeout(autoSaveTimer.current)
          }
          autoSaveTimer.current = setTimeout(() => {
            const latestBody = plateEditor.getApi(MarkdownPlugin).markdown.serialize()
            onAutoSave(reconstructContent(currentFrontmatterRef.current, latestBody))
          }, autoSaveDelay)
        }
      }}
    >
      <div className="editor-wrapper potion-editor-wrapper">
        <div className="editor-toolbar">
          <PotionToolbar />
          <div className="editor-toolbar-right">
            {effectiveMode !== 'git-diff' && <SaveStatus isDirty={isDirty} isSaving={isSaving} />}
            {showDiffToggle && (
              <div className="editor-mode-selector">
                <button
                  type="button"
                  className={`mode-btn${effectiveMode === 'rendered' ? ' active' : ''}`}
                  onClick={() => onModeChange?.('rendered')}
                  title="Edit markdown"
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={`mode-btn${effectiveMode === 'git-diff' ? ' active' : ''}`}
                  onClick={() => onModeChange?.('git-diff')}
                  title="View git diff"
                >
                  Raw
                </button>
              </div>
            )}
          </div>
        </div>

        {effectiveMode !== 'git-diff' && (
          <FrontmatterEditor
            frontmatter={currentFrontmatter}
            onChange={handleFrontmatterChange}
            isCollapsed={frontmatterCollapsed}
            onToggleCollapse={() => setFrontmatterCollapsed(!frontmatterCollapsed)}
            isDiffMode={false}
            originalFrontmatter={originalContent ? parseFrontmatter(originalContent).frontmatter : null}
          />
        )}

        <div className="editor-content" onDrop={handleDrop} onDragOver={handleDragOver}>
          {effectiveMode === 'git-diff' ? (
            <>
              {diffError && <div className="diff-error">{diffError}</div>}
              <GitDiff diff={diffText} showFileHeader={false} />
            </>
          ) : (
            <PlateContent
              className="potion-content"
              disableDefaultStyles
              placeholder="Start writing..."
            />
          )}
        </div>
      </div>
    </Plate>
  )
}
