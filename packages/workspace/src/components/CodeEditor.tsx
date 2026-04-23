"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { EditorState, type Extension, Compartment } from "@codemirror/state"
import {
  EditorView,
  keymap,
  lineNumbers as lineNumbersExt,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { javascript } from "@codemirror/lang-javascript"
import { python } from "@codemirror/lang-python"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { markdown } from "@codemirror/lang-markdown"
import { sql } from "@codemirror/lang-sql"
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { createShadcnTheme } from "../theme/codemirror-theme"
import { cn } from "../lib/utils"

const LARGE_FILE_THRESHOLD = 1_000_000
const DOWNLOAD_THRESHOLD = 10_000_000

export interface CodeEditorProps {
  content: string
  onChange?: (content: string) => void
  language?: string
  readOnly?: boolean
  lineNumbers?: boolean
  wordWrap?: boolean
  className?: string
}

function getLanguageExtension(language: string): Extension | null {
  switch (language) {
    case "javascript":
    case "js":
    case "jsx":
      return javascript({ jsx: true })
    case "typescript":
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true })
    case "python":
    case "py":
      return python()
    case "json":
      return json()
    case "yaml":
    case "yml":
      return yaml()
    case "markdown":
    case "md":
      return markdown()
    case "sql":
      return sql()
    default:
      return null
  }
}

export function CodeEditor({
  content,
  onChange,
  language = "typescript",
  readOnly = false,
  lineNumbers = true,
  wordWrap = false,
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const suppressChangeRef = useRef(false)

  const languageCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())
  const lineNumbersCompartment = useRef(new Compartment())
  const wordWrapCompartment = useRef(new Compartment())

  const isLargeFile = content.length >= LARGE_FILE_THRESHOLD
  const isDownloadFile = content.length >= DOWNLOAD_THRESHOLD
  const effectiveReadOnly = readOnly || isLargeFile

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      readOnlyCompartment.current.of(EditorState.readOnly.of(effectiveReadOnly)),
      lineNumbersCompartment.current.of(lineNumbers ? lineNumbersExt() : []),
      wordWrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
      drawSelection(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      history(),
      highlightSelectionMatches(),
      foldGutter(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
      createShadcnTheme(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    ]

    if (!isLargeFile) {
      const langExt = getLanguageExtension(language)
      exts.push(languageCompartment.current.of(langExt ?? []))
    } else {
      exts.push(languageCompartment.current.of([]))
    }

    exts.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !suppressChangeRef.current) {
          onChangeRef.current?.(update.state.doc.toString())
        }
      }),
    )

    return exts
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- compartments handle dynamic reconfiguration

  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({ doc: content, extensions })
    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- intentional mount-only

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== content) {
      suppressChangeRef.current = true
      view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      })
      suppressChangeRef.current = false
    }
  }, [content])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(effectiveReadOnly),
      ),
    })
  }, [effectiveReadOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: lineNumbersCompartment.current.reconfigure(
        lineNumbers ? lineNumbersExt() : [],
      ),
    })
  }, [lineNumbers])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wordWrapCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : [],
      ),
    })
  }, [wordWrap])

  useEffect(() => {
    const view = viewRef.current
    if (!view || isLargeFile) return
    const langExt = getLanguageExtension(language)
    view.dispatch({
      effects: languageCompartment.current.reconfigure(langExt ?? []),
    })
  }, [language, isLargeFile])

  if (isLargeFile) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <span>Large file — editing disabled</span>
          {isDownloadFile && (
            <button
              type="button"
              className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-accent transition-colors"
              onClick={() => {
                const blob = new Blob([content], { type: "text/plain" })
                const url = URL.createObjectURL(blob)
                const a = document.createElement("a")
                a.href = url
                a.download = "file.txt"
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download
            </button>
          )}
        </div>
        <div ref={containerRef} className="flex-1 overflow-hidden" />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn("h-full overflow-hidden", className)}
    />
  )
}
