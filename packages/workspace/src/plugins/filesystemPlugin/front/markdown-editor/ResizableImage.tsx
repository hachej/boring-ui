"use client"

import { useEffect, useRef, useState } from "react"
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react"
import Image from "@tiptap/extension-image"
import { cn } from "../../../../front/lib/utils"

type ImageSrcResolver = (src: string) => string

const MIN_WIDTH = 64
const MAX_WIDTH = 2000

function escapeMarkdownImageText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]")
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function numericAttribute(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

/**
 * Image extension with persisted width + a corner drag handle.
 *
 * The width is stored on the node as a plain numeric attribute. Plain images
 * serialize as GitHub-compatible markdown (`![alt](src)`). Resized/aligned
 * images serialize as GitHub-compatible HTML so width/alignment survives.
 * The NodeView only kicks in inside the editor.
 */
export const ResizableImage = Image.extend<any>({
  name: "image",
  draggable: true,

  addOptions() {
    return {
      ...this.parent?.(),
      resolveSrc: (src: string) => src,
      resizable: true,
    }
  },

  parseMarkdown: (token: { href?: string; title?: string | null; text?: string }, helpers: any) => {
    return helpers.createNode("image", {
      src: token.href,
      title: token.title,
      alt: token.text,
    })
  },

  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : ""
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : ""
    const title = typeof node.attrs?.title === "string" ? node.attrs.title : ""
    const width = numericAttribute(node.attrs?.width)
    const height = numericAttribute(node.attrs?.height)
    const align = node.attrs?.align === "center" || node.attrs?.align === "right" ? node.attrs.align : "left"

    if (!width && !height && align === "left") {
      const escapedAlt = escapeMarkdownImageText(alt)
      return title
        ? `![${escapedAlt}](${src} "${title.replace(/"/g, "\\\"")}")`
        : `![${escapedAlt}](${src})`
    }

    const attrs = [
      `src="${escapeHtmlAttribute(src)}"`,
      alt ? `alt="${escapeHtmlAttribute(alt)}"` : null,
      title ? `title="${escapeHtmlAttribute(title)}"` : null,
      width ? `width="${width}"` : null,
      height ? `height="${height}"` : null,
    ].filter(Boolean).join(" ")
    const img = `<img ${attrs} />`
    return align === "center" || align === "right" ? `<p align="${align}">${img}</p>` : img
  },

  addAttributes() {
    const parent = (this.parent?.() as Record<string, unknown>) ?? {}
    return {
      ...parent,
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const attr = el.getAttribute("width")
          if (attr) {
            const n = parseInt(attr, 10)
            return Number.isFinite(n) ? n : null
          }
          // also accept inline style="width: 400px"
          const style = el.style.width
          if (style && style.endsWith("px")) {
            const n = parseInt(style, 10)
            return Number.isFinite(n) ? n : null
          }
          return null
        },
        renderHTML: (attrs: { width?: number | null }) => {
          if (!attrs.width) return {}
          return { width: String(attrs.width) }
        },
      },
      align: {
        default: "left",
        parseHTML: (el: HTMLElement) => {
          const dataAlign = el.getAttribute("data-align")
          if (dataAlign === "left" || dataAlign === "center" || dataAlign === "right") {
            return dataAlign
          }
          if (el.style.marginLeft === "auto" && el.style.marginRight === "auto") return "center"
          if (el.style.marginLeft === "auto") return "right"
          return "left"
        },
        renderHTML: (attrs: { align?: "left" | "center" | "right" }) => {
          const align = attrs.align ?? "left"
          return { "data-align": align }
        },
      },
      // Transient marker used by MarkdownEditor.insertImageRef to find THIS
      // specific inserted image when its background upload completes, even
      // if the user pasted the same file twice (which produces two image
      // nodes with identical `src` data URLs). Never serialized to HTML or
      // markdown — purely in-memory state for the swap.
      pendingUploadId: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

function ResizableImageView({ node, updateAttributes, selected, extension }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const storedSrc = (node.attrs.src as string | undefined) ?? ""
  const resolveSrc = (extension.options as { resolveSrc?: ImageSrcResolver }).resolveSrc ?? ((value: string) => value)
  const src = resolveSrc(storedSrc)
  const resizable = (extension.options as { resizable?: boolean }).resizable !== false
  const alt = (node.attrs.alt as string | undefined) ?? ""
  const title = (node.attrs.title as string | undefined) ?? undefined
  const width = node.attrs.width as number | null | undefined
  const align = (node.attrs.align as "left" | "center" | "right" | undefined) ?? "left"

  useEffect(() => {
    if (!dragging || !resizable) return
    const onMove = (e: PointerEvent) => {
      const start = startRef.current
      if (!start) return
      const delta = e.clientX - start.x
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start.width + delta))
      updateAttributes({ width: Math.round(next) })
    }
    const onUp = () => {
      startRef.current = null
      setDragging(false)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [dragging, resizable, updateAttributes])

  const onHandlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!resizable) return
    e.preventDefault()
    e.stopPropagation()
    const img = wrapperRef.current?.querySelector("img")
    const startWidth = width ?? img?.getBoundingClientRect().width ?? 320
    startRef.current = { x: e.clientX, width: startWidth }
    setDragging(true)
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      data-resizable-image=""
      data-selected={selected ? "true" : undefined}
      className={cn(
        "relative block max-w-full align-baseline",
        "[&>img]:block [&>img]:max-w-full [&>img]:h-auto [&>img]:rounded-md",
        align === "left" && "mr-auto",
        align === "center" && "mx-auto",
        align === "right" && "ml-auto",
        resizable && selected &&
          "ring-2 ring-[color:var(--accent)] ring-offset-1 ring-offset-background",
      )}
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img src={src} alt={alt} title={title} draggable={false} />
      {resizable && (
        <span
          role="slider"
          aria-label="Resize image"
          aria-valuenow={width ?? 0}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          data-testid="resize-handle"
          onPointerDown={onHandlePointerDown}
          className={cn(
            "absolute right-0 bottom-0 h-3 w-3 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
            "rounded-full border border-background bg-[color:var(--accent)] shadow",
            "opacity-0 transition-opacity duration-150 ease-out",
            (selected || dragging) && "opacity-100",
          )}
        />
      )}
    </NodeViewWrapper>
  )
}
