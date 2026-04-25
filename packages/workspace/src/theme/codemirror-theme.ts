import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "oklch(0.7 0.15 300)" },
  { tag: [tags.name, tags.deleted, tags.character, tags.macroName], color: "var(--foreground)" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "oklch(0.75 0.15 210)" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "oklch(0.75 0.12 60)" },
  { tag: [tags.definition(tags.name), tags.separator], color: "var(--foreground)" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "oklch(0.75 0.12 60)" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "oklch(0.7 0.12 180)" },
  { tag: [tags.meta, tags.comment], color: "var(--muted-foreground)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "oklch(0.7 0.12 180)", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "oklch(0.75 0.15 210)" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "oklch(0.75 0.12 60)" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "oklch(0.75 0.12 140)" },
  { tag: tags.invalid, color: "var(--destructive)" },
])

export function createShadcnTheme(options?: { dark?: boolean }) {
  const t = EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        color: "var(--foreground)",
        height: "100%",
      },
      ".cm-content": {
        caretColor: "var(--foreground)",
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "oklch(from var(--muted-foreground) l c h / 0.55)",
        borderRight: "none",
        paddingRight: "12px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 6px 0 12px",
        fontVariantNumeric: "tabular-nums",
        fontSize: "12px",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "oklch(0.62 0.14 65 / 0.05)",
        color: "var(--foreground)",
      },
      ".cm-activeLine": {
        backgroundColor: "oklch(0.62 0.14 65 / 0.04)",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "oklch(0.62 0.14 65)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "oklch(0.62 0.14 65 / 0.16)",
      },
      ".cm-panels": {
        backgroundColor: "var(--muted)",
        color: "var(--foreground)",
      },
      ".cm-panels.cm-panels-top": {
        borderBottom: "1px solid var(--border)",
      },
      ".cm-panels.cm-panels-bottom": {
        borderTop: "1px solid var(--border)",
      },
      ".cm-searchMatch": {
        backgroundColor: "oklch(0.8 0.15 80 / 0.3)",
        outline: "1px solid oklch(0.8 0.15 80 / 0.5)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "oklch(0.7 0.15 80 / 0.5)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm, 4px)",
      },
      ".cm-tooltip-autocomplete": {
        "& > ul > li[aria-selected]": {
          backgroundColor: "var(--accent)",
          color: "var(--accent-foreground)",
        },
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--muted)",
        border: "1px solid var(--border)",
        color: "var(--muted-foreground)",
      },
    },
    { dark: options?.dark ?? false },
  )
  return [t, syntaxHighlighting(highlightStyle)]
}
