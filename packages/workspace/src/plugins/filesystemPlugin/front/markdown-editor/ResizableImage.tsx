"use client"

import { useEffect, useRef, useState } from "react"
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react"
import Image from "@tiptap/extension-image"
import { cn } from "../../../../front/lib/utils"

const MIN_WIDTH = 64
const MAX_WIDTH = 2000

/**
 * Image extension with persisted width + a corner drag handle.
 *
 * The width is stored on the node as a plain numeric attribute so it
 * round-trips through Tiptap markdown/HTML serialization (`<img width=400>`).
 * The NodeView only kicks in inside the editor; serialized output is a plain
 * `<img>` so other markdown renderers don't need anything special.
 */
export const ResizableImage = Image.extend({
  name: "image",
  draggable: true,

  addStorage() {
    return {
      ...(this.parent?.() ?? {}),
      markdown: {
        serialize(stateOrArgs: any, maybeNode?: any) {
          const state = maybeNode ? stateOrArgs : stateOrArgs.state
          const node = maybeNode ?? stateOrArgs.node
          const src: string = node.attrs.src ?? ""
          const alt: string = node.attrs.alt ?? ""
          const title: string | undefined = node.attrs.title || undefined
          state.write(`![${alt}](${src}${title ? ` "${title}"` : ""})`)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
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
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const src = (node.attrs.src as string | undefined) ?? ""
  const alt = (node.attrs.alt as string | undefined) ?? ""
  const title = (node.attrs.title as string | undefined) ?? undefined
  const width = node.attrs.width as number | null | undefined
  const align = (node.attrs.align as "left" | "center" | "right" | undefined) ?? "left"

  useEffect(() => {
    if (!dragging) return
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
  }, [dragging, updateAttributes])

  const onHandlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
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
        selected &&
          "ring-2 ring-[color:var(--accent)] ring-offset-1 ring-offset-background",
      )}
      style={{ width: width ? `${width}px` : undefined }}
    >
      <img src={src} alt={alt} title={title} draggable={false} />
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
    </NodeViewWrapper>
  )
}
