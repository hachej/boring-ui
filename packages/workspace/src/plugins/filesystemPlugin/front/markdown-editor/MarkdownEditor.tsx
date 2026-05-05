"use client"

import { useCallback, useEffect, useRef } from "react"
import type { ChangeEvent } from "react"
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
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import { Markdown } from "tiptap-markdown"
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
} from "lucide-react"
import { Input, Toolbar as UiToolbar, ToolbarButton as UiToolbarButton, ToolbarSeparator as UiToolbarSeparator } from "@boring/ui"
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
}

const extensions = [
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
    html: true,
    transformPastedText: true,
    transformCopiedText: true,
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

function Toolbar({ editor }: { editor: Editor | null }) {
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
    try {
      const dataUrl = await readFileAsDataUrl(file)
      editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run()
    } catch {
      // FileReader rejected — silently ignore; the user can retry.
    }
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
    </UiToolbar>
  )
}

export function MarkdownEditor({
  content,
  onChange,
  readOnly = false,
  placeholder,
  className,
}: MarkdownEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const suppressChangeRef = useRef(false)

  const editor = useEditor({
    extensions: placeholder
      ? [
          ...extensions.filter((e) => e.name !== "placeholder"),
          Placeholder.configure({ placeholder }),
        ]
      : extensions,
    content,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "tiptap-prose max-w-[68ch] px-8 py-6 focus:outline-none min-h-[200px]",
      },
      transformPastedHTML: sanitizeHtml,
    },
    onUpdate: ({ editor: e }) => {
      if (!suppressChangeRef.current) {
        onChangeRef.current?.((e.storage as Record<string, any>).markdown?.getMarkdown?.() ?? e.getHTML())
      }
    },
  })

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const current = (editor.storage as Record<string, any>).markdown?.getMarkdown?.() ?? editor.getHTML()
    if (current === content) return
    suppressChangeRef.current = true
    editor.commands.setContent(content)
    suppressChangeRef.current = false
  }, [editor, content])

  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      {!readOnly && <Toolbar editor={editor} />}
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
