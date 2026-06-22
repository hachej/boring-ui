"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react"
import { useEditor, useEditorState, EditorContent } from "@tiptap/react"
import type { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import TextAlign from "@tiptap/extension-text-align"
import Highlight from "@tiptap/extension-highlight"
import { Table } from "@tiptap/extension-table"
import { TableRow } from "@tiptap/extension-table-row"
import { TableHeader } from "@tiptap/extension-table-header"
import { TableCell } from "@tiptap/extension-table-cell"
import { ResizableImage } from "./ResizableImage"
import { useApiBaseUrl, useWorkspaceRequestId } from "../data/DataProvider"
import { useFileUpload } from "../data/useFileUpload"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import { Markdown } from "@tiptap/markdown"
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListChecksIcon,
  QuoteIcon,
  CodeIcon,
  LinkIcon,
  ImageIcon,
  HighlighterIcon,
  MinusIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon,
  Loader2Icon,
} from "lucide-react"
import { Input, Toolbar as UiToolbar, ToolbarButton as UiToolbarButton, ToolbarSeparator as UiToolbarSeparator } from "@hachej/boring-ui-kit"
import { postUiCommand } from "../../../../front/bridge/uiCommandBus"
import { cn } from "../../../../front/lib/utils"

const lowlight = createLowlight(common)

const SANITIZE_PATTERNS = [
  /<script[\s>][\s\S]*?<\/script>/gi,
  /<iframe[\s>][\s\S]*?<\/iframe>/gi,
  /\s+on\w+\s*=\s*["'][^"']*["']/gi,
  /\s+on\w+\s*=\s*\S+/gi,
  /href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi,
  /src\s*=\s*["']?\s*javascript:[^"'\s>]*/gi,
]

export function sanitizeHtml(html: string): string {
  let result = html
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result
}

export interface MarkdownEditorProps {
  content: string
  onChange?: (content: string) => void
  readOnly?: boolean
  placeholder?: string
  className?: string
  /** Workspace-relative markdown file path, used to make uploaded image links relative. */
  documentPath?: string
}

export function countMarkdownWords(content: string): number {
  const plainText = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}[-*_]{3,}\s*$/gm, " ")
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/^\s{0,3}\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/[*_~>#]/g, " ")
  const matches = plainText.match(/\b[\p{L}\p{N}']+\b/gu)
  return matches?.length ?? 0
}

function formatWordCountLabel(count: number): string {
  return `${count} word${count === 1 ? "" : "s"}`
}

function isExternalImageSrc(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(src)
}

/**
 * Decide whether a TipTap `onUpdate` emission is a genuine user edit worth
 * propagating to `onChange`.
 *
 * TipTap fires `onUpdate` not only for typed input but also while the editor
 * settles on init / remount / DOM re-parent. Those unfocused emissions can be
 * non-empty normalized markdown (for example frontmatter rewritten as a rule +
 * heading), so saving them can corrupt files before the user touches anything.
 * Keep toolbar edits working too: focus may be on a toolbar button, so a prior
 * pointer/key interaction inside this editor shell also marks updates as user
 * initiated.
 */
export function isUserEditedChange(
  _nextContent: string,
  editorFocused: boolean,
  userInteracted = false,
): boolean {
  return editorFocused || userInteracted
}

function normalizeRelativeImagePath(src: string, documentPath?: string): string {
  const match = src.match(/^([^?#]*)([?#].*)?$/)
  const pathPart = match?.[1] ?? src
  const suffix = match?.[2] ?? ""
  const docDir = documentPath?.includes("/") ? documentPath.slice(0, documentPath.lastIndexOf("/")) : ""
  const parts = `${docDir ? `${docDir}/` : ""}${pathPart}`.split("/")
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return `${out.join("/")}${suffix}`
}

export function rawFileUrlForMarkdownImage(
  src: string,
  documentPath: string | undefined,
  apiBaseUrl: string,
  workspaceRequestId?: string | null,
): string {
  if (!src || isExternalImageSrc(src)) return src
  const path = normalizeRelativeImagePath(src, documentPath)
  const base = apiBaseUrl.replace(/\/$/, "")
  const params = new URLSearchParams({ path })
  if (workspaceRequestId) params.set("workspaceId", workspaceRequestId)
  return `${base}/api/v1/files/raw?${params.toString()}`
}

function isExternalLinkHref(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(href)
}

export function workspaceFilePathForMarkdownLink(href: string, documentPath?: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || isExternalLinkHref(trimmed)) return null
  const pathPart = trimmed.split(/[?#]/, 1)[0]
  if (!pathPart) return null
  const docDir = documentPath?.includes("/") ? documentPath.slice(0, documentPath.lastIndexOf("/")) : ""
  const parts = `${docDir ? `${docDir}/` : ""}${pathPart}`.split("/")
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join("/") || null
}

function shouldHandleWorkspaceLinkClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}

const baseExtensions = [
  StarterKit.configure({
    codeBlock: false,
    link: false,
    underline: false,
  }),
  Underline,
  Link.configure({
    openOnClick: true,
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: "https",
    isAllowedUri: (url, ctx) =>
      isSafeUrl(url) && (workspaceFilePathForMarkdownLink(url) !== null || ctx.defaultValidate(url)),
    HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
  }),
  Placeholder.configure({
    placeholder: "Start writing...",
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TextAlign.configure({
    types: ["heading", "paragraph"],
  }),
  Highlight,
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  ResizableImage.configure({
    inline: false,
    allowBase64: true,
  }),
  CodeBlockLowlight.configure({ lowlight }),
  Markdown.configure({
    markedOptions: {
      gfm: true,
      breaks: false,
      pedantic: false,
    },
  }),
]

interface ToolbarButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, disabled, title, children }: ToolbarButtonProps) {
  return (
    <UiToolbarButton
      type="button"
      size="icon-xs"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        "text-muted-foreground/70",
        active && "bg-[color:var(--accent-soft)] text-[color:var(--accent)]",
      )}
    >
      {children}
    </UiToolbarButton>
  )
}

function ToolbarSeparator() {
  return <UiToolbarSeparator className="mx-2 h-3.5" />
}

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:text/html")
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"))
    reader.readAsDataURL(file)
  })
}

function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const file of Array.from(data.files ?? [])) {
    if (file.type.startsWith("image/")) return file
  }
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

function Toolbar({
  editor,
  onInsertImage,
  rawMode,
  onToggleRawMode,
  uploading,
}: {
  editor: Editor | null
  onInsertImage: (file: File) => Promise<void>
  rawMode: boolean
  onToggleRawMode: () => void
  uploading: boolean
}) {
  const setBlockAlign = (align: "left" | "center" | "right") => {
    if (!editor) return
    if (editor.isActive("image")) {
      editor.chain().focus().updateAttributes("image", { align }).run()
      return
    }
    editor.chain().focus().setTextAlign(align).run()
  }
  const imageFileInputRef = useRef<HTMLInputElement>(null)

  // useEditor in TipTap v3 no longer re-renders on transactions by default;
  // subscribe explicitly so toolbar active states stay in sync.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
            taskList: e.isActive("taskList"),
            blockquote: e.isActive("blockquote"),
            codeBlock: e.isActive("codeBlock"),
            link: e.isActive("link"),
            highlight: e.isActive("highlight"),
            alignLeft:
              e.isActive("image")
                ? (e.getAttributes("image").align ?? "left") === "left"
                : e.isActive({ textAlign: "left" }),
            alignCenter:
              e.isActive("image")
                ? e.getAttributes("image").align === "center"
                : e.isActive({ textAlign: "center" }),
            alignRight:
              e.isActive("image")
                ? e.getAttributes("image").align === "right"
                : e.isActive({ textAlign: "right" }),
          }
        : null,
  })

  if (!editor || !state) return null

  const promptLink = () => {
    const url = window.prompt("URL:")
    if (url && isSafeUrl(url)) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
    }
  }

  const promptImageUrl = () => {
    const url = window.prompt("Image URL:")
    if (url && isSafeUrl(url)) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }

  const triggerImagePick = (e?: { shiftKey?: boolean }) => {
    if (e?.shiftKey) {
      promptImageUrl()
      return
    }
    imageFileInputRef.current?.click()
  }
  const handleImageFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = "" // allow picking the same file twice in a row
    if (!file || !file.type.startsWith("image/")) return
    await onInsertImage(file)
  }

  return (
    <UiToolbar className="border-b border-border/60 bg-background px-3 py-1.5" aria-label="Formatting toolbar">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={state.bold} title="Bold">
        <BoldIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={state.italic} title="Italic">
        <ItalicIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={state.underline} title="Underline">
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={state.strike} title="Strikethrough">
        <StrikethroughIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={state.h1} title="Heading 1">
        <Heading1Icon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={state.h2} title="Heading 2">
        <Heading2Icon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={state.h3} title="Heading 3">
        <Heading3Icon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={state.bulletList} title="Bullet list">
        <ListIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={state.orderedList} title="Ordered list">
        <ListOrderedIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={state.taskList} title="Task list">
        <ListChecksIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={state.blockquote} title="Quote">
        <QuoteIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={state.codeBlock} title="Code block">
        <CodeIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={promptLink} active={state.link} title="Link">
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={triggerImagePick}
        title="Image (click to upload, Shift+click for URL)"
      >
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <Input
        ref={imageFileInputRef}
        data-testid="image-file-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={state.highlight} title="Highlight">
        <HighlighterIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => setBlockAlign("left")} active={state.alignLeft} title="Align left">
        <AlignLeftIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => setBlockAlign("center")} active={state.alignCenter} title="Center align">
        <AlignCenterIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => setBlockAlign("right")} active={state.alignRight} title="Align right">
        <AlignRightIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        <MinusIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      {uploading && (
        <span
          role="status"
          aria-live="polite"
          className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground/80"
        >
          <Loader2Icon className="h-3 w-3 animate-spin" aria-hidden />
          Uploading…
        </span>
      )}

      <ToolbarButton
        onClick={onToggleRawMode}
        active={rawMode}
        title={rawMode ? "Rich text" : "Raw markdown"}
      >
        <span className="font-mono text-[10px] font-semibold leading-none tracking-[-0.02em]">
          MD
        </span>
      </ToolbarButton>
    </UiToolbar>
  )
}

export function MarkdownEditor({
  content,
  onChange,
  readOnly = false,
  placeholder,
  className,
  documentPath,
}: MarkdownEditorProps) {
  const apiBaseUrl = useApiBaseUrl()
  const workspaceRequestId = useWorkspaceRequestId()
  const { upload, uploading } = useFileUpload()
  const [rawMode, setRawMode] = useState(false)
  const editorExtensions = useMemo(() => {
    const imageExtension = ResizableImage.configure({
      inline: false,
      allowBase64: true,
      resolveSrc: (src: string) => rawFileUrlForMarkdownImage(src, documentPath, apiBaseUrl, workspaceRequestId),
    })
    const configured = baseExtensions.map((extension) => extension.name === "image" ? imageExtension : extension)
    return placeholder
      ? [
          ...configured.filter((e) => e.name !== "placeholder"),
          Placeholder.configure({ placeholder }),
        ]
      : configured
  }, [apiBaseUrl, documentPath, placeholder, workspaceRequestId])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const suppressChangeRef = useRef(false)
  const userInteractedRef = useRef(false)
  // Tracks the last markdown string the editor itself emitted (or was seeded
  // with). TipTap normalizes markdown on serialize, so the `content` prop that
  // comes back from a save round-trip rarely equals the original disk bytes.
  // Comparing against this ref (rather than re-seeding on every refetch) keeps
  // the editor from marking itself dirty / autosaving on its own output.
  const lastEmittedRef = useRef<string>(content)
  const editorRef = useRef<Editor | null>(null)
  const wordCount = useMemo(() => countMarkdownWords(content), [content])

  // Stable ref so handlePaste (created once in useEditor) always calls the latest version.
  const insertImageRef = useRef<(file: File) => Promise<void>>(async () => {})
  insertImageRef.current = async (file: File) => {
    const editor = editorRef.current
    if (!editor) return

    // Insert with the data URL first so the image shows up instantly at the
    // caret. Uploads can be slow; without this the paste appears to do nothing.
    let dataUrl: string
    try {
      dataUrl = await readFileAsDataUrl(file)
    } catch {
      return
    }
    // Unique marker so we can find THIS specific insertion later, even when
    // the user pastes the same file twice (two image nodes, identical data
    // URLs). Matching by `src === dataUrl` would update both on the first
    // upload completion and orphan the second uploaded URL.
    const pendingUploadId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const imageOptions = { src: dataUrl, alt: file.name, pendingUploadId }
    editor
      .chain()
      .focus()
      .setImage(imageOptions)
      .run()

    // Upload in the background and swap the inserted node's src to the
    // persisted workspace path. On failure we leave the data URL in place so
    // the paste is not lost.
    try {
      const { url } = await upload(file, { sourcePath: documentPath })
      const ed = editorRef.current
      if (!ed || ed.isDestroyed) return
      ed.commands.command(({ tr, state }) => {
        state.doc.descendants((node, pos) => {
          if (node.type.name === "image" && node.attrs.pendingUploadId === pendingUploadId) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url, pendingUploadId: null })
          }
          return true
        })
        return true
      })
    } catch {
      // Upload failed — clear the marker so we don't leave the node in a
      // "pending forever" state (purely cosmetic for any future feature
      // keyed off the marker; functionally the data URL stays put).
      const ed = editorRef.current
      if (!ed || ed.isDestroyed) return
      ed.commands.command(({ tr, state }) => {
        state.doc.descendants((node, pos) => {
          if (node.type.name === "image" && node.attrs.pendingUploadId === pendingUploadId) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, pendingUploadId: null })
          }
          return true
        })
        return true
      })
    }
  }

  const editorContent = content
    ? content
    : { type: "doc", content: [{ type: "paragraph" }] }
  const editorContentType = content ? "markdown" : "json"

  const editor = useEditor({
    extensions: editorExtensions,
    content: editorContent,
    contentType: editorContentType,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "tiptap-prose max-w-[68ch] px-8 py-6 focus:outline-none min-h-[200px]",
      },
      transformPastedHTML: sanitizeHtml,
      handlePaste: (_view, event) => {
        if (readOnly) return false
        const file = imageFileFromClipboard(event.clipboardData)
        if (!file) return false
        event.preventDefault()
        void insertImageRef.current(file)
        return true
      },
    },
    onUpdate: ({ editor: e }) => {
      if (suppressChangeRef.current) return
      const next = e.getMarkdown?.() ?? e.getHTML()
      // Remember our own serialized output so the content-sync effect can tell
      // a save round-trip (normalized markdown) apart from a genuine external
      // change, and never re-seeds / re-dirties on what we produced. This is the
      // load-bearing fix for the autosave/conflict storm — see the sync effect.
      lastEmittedRef.current = next
      // Drop a transient empty emission from an unfocused editor (settling on
      // init/remount); real edits — typing AND toolbar actions — still flow.
      if (!isUserEditedChange(next, e.isFocused, userInteractedRef.current)) return
      onChangeRef.current?.(next)
    },
  })
  editorRef.current = editor

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    // The incoming `content` is exactly what this editor last emitted (a save
    // round-trip of our own normalized markdown). Re-seeding here would reset
    // the doc and re-mark it dirty on every refetch — the autosave ping-pong.
    if (content === lastEmittedRef.current) return
    // Backstop: if the editor's current serialization already matches, there's
    // nothing to apply.
    const current = editor.getMarkdown?.() ?? editor.getHTML()
    if (current === content) return
    // Genuine external change (a different document, e.g. an agent write) —
    // apply it and record it as our new baseline so the round-trip of THIS
    // content doesn't re-trigger a re-seed.
    suppressChangeRef.current = true
    editor.commands.setContent(editorContent, { contentType: editorContentType })
    suppressChangeRef.current = false
    lastEmittedRef.current = content
  }, [editor, content])

  const handleEditorClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!shouldHandleWorkspaceLinkClick(event.nativeEvent)) return
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null
    const href = target?.getAttribute("href")
    if (!href) return
    const path = workspaceFilePathForMarkdownLink(href, documentPath)
    if (!path) return
    event.preventDefault()
    event.stopPropagation()
    postUiCommand({ kind: "openFile", params: { path } })
  }

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
      onPointerDownCapture={() => { userInteractedRef.current = true }}
      onClickCapture={() => { userInteractedRef.current = true }}
      onKeyDownCapture={() => { userInteractedRef.current = true }}
    >
      {!readOnly && (
        <Toolbar
          editor={editor}
          onInsertImage={(file) => insertImageRef.current(file)}
          rawMode={rawMode}
          onToggleRawMode={() => setRawMode((v) => !v)}
          uploading={uploading}
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto" onClickCapture={handleEditorClick}>
        {rawMode && !readOnly ? (
          <textarea
            aria-label="Raw markdown"
            data-testid="markdown-raw-editor"
            className="h-full min-h-[200px] w-full resize-none bg-background px-8 py-6 font-mono text-[13px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
            value={content}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => onChangeRef.current?.(e.target.value)}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
      <div className="border-t border-border/60 px-4 py-2 text-right text-xs text-muted-foreground" data-testid="markdown-word-count">
        {formatWordCountLabel(wordCount)}
      </div>
    </div>
  )
}
