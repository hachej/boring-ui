"use client"

import { useCallback, useEffect, useRef } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import TextAlign from "@tiptap/extension-text-align"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
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
} from "lucide-react"
import { cn } from "../lib/utils"

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
    openOnClick: false,
    HTMLAttributes: { rel: "noopener noreferrer nofollow" },
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
  Image.configure({
    inline: true,
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
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}

function ToolbarButton({ onClick, active, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  )
}

function ToolbarSeparator() {
  return <div className="mx-0.5 h-5 w-px bg-border" />
}

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:text/html")
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null

  const promptLink = () => {
    const url = window.prompt("URL:")
    if (url && isSafeUrl(url)) {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }

  const promptImage = () => {
    const url = window.prompt("Image URL:")
    if (url && isSafeUrl(url)) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1" role="toolbar" aria-label="Formatting toolbar">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
        <BoldIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
        <ItalicIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Underline">
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")} title="Strikethrough">
        <StrikethroughIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Heading 1">
        <Heading1Icon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
        <Heading2Icon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
        <Heading3Icon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
        <ListIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Ordered list">
        <ListOrderedIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive("taskList")} title="Task list">
        <ListChecksIcon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
        <QuoteIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block">
        <CodeIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={promptLink} active={editor.isActive("link")} title="Link">
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={promptImage} title="Image">
        <ImageIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={editor.isActive("highlight")} title="Highlight">
        <HighlighterIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        <MinusIcon className="h-4 w-4" />
      </ToolbarButton>
    </div>
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
        class: "prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none min-h-[200px]",
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
