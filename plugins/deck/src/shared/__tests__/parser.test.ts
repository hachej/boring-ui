import { describe, expect, it } from "vitest"
import {
  isDeckMarkdownPath,
  normalizeDeckPath,
  parseDeckMarkdown,
  parseWidgetAttrs,
  splitSlides,
} from "../index"

describe("deck parser", () => {
  it("extracts YAML frontmatter title from a macro-like deck fixture", () => {
    const fixture = `---
title: "Labor Briefing"
owner: macro
---

# Slide 1

{{TimeSeries ids="UNRATE" title="Unemployment"}}`

    const parsed = parseDeckMarkdown(fixture)

    expect(parsed.title).toBe("Labor Briefing")
    expect(parsed.slides).toHaveLength(1)
    expect(parsed.slides[0]?.segments).toEqual([
      { type: "markdown", text: "# Slide 1\n\n" },
      {
        type: "widget",
        name: "TimeSeries",
        attrs: { ids: "UNRATE", title: "Unemployment" },
        raw: '{{TimeSeries ids="UNRATE" title="Unemployment"}}',
        position: "block",
      },
    ])
  })

  it("preserves legacy leading delimiter plus title line behavior", () => {
    const parsed = parseDeckMarkdown(`---\n## title: Briefing\n\n# Slide 1\n`) 

    expect(parsed.title).toBe("Briefing")
    expect(parsed.slides.map((slide) => slide.raw)).toEqual(["# Slide 1"])
  })

  it("returns one empty slide for an empty file", () => {
    const parsed = parseDeckMarkdown("")

    expect(parsed.title).toBeUndefined()
    expect(parsed.slides).toHaveLength(1)
    expect(parsed.slides[0]).toEqual({
      index: 0,
      raw: "",
      segments: [{ type: "markdown", text: "" }],
    })
  })

  it("keeps a single slide when there are no delimiters", () => {
    const parsed = parseDeckMarkdown("# Only slide\n\nText")
    expect(parsed.slides.map((slide) => slide.raw)).toEqual(["# Only slide\n\nText"])
  })

  it("ignores a trailing delimiter line", () => {
    expect(splitSlides("# Slide 1\n---\n")).toEqual(["# Slide 1"])
  })

  it("does not split on delimiter-looking lines inside fenced code", () => {
    const slides = splitSlides("# Slide 1\n```md\n---\n```\n---\n# Slide 2")
    expect(slides).toEqual(["# Slide 1\n```md\n---\n```", "# Slide 2"])
  })

  it("does not parse widgets inside fenced code blocks or inline code spans", () => {
    const parsed = parseDeckMarkdown([
      "# Slide 1",
      "",
      "Inline `{{TimeSeries ids=\"NOPE\"}}` stays literal.",
      "",
      "```md",
      "{{TimeSeries ids=\"ALSO_NOPE\"}}",
      "```",
      "",
      "{{UnknownWidget key=\"value\"}}",
    ].join("\n"))

    expect(parsed.slides[0]?.segments).toEqual([
      {
        type: "markdown",
        text: "# Slide 1\n\nInline `{{TimeSeries ids=\"NOPE\"}}` stays literal.\n\n```md\n{{TimeSeries ids=\"ALSO_NOPE\"}}\n```\n\n",
      },
      {
        type: "widget",
        name: "UnknownWidget",
        attrs: { key: "value" },
        raw: '{{UnknownWidget key="value"}}',
        position: "block",
      },
    ])
  })

  it("keeps malformed widget attrs as markdown text", () => {
    const parsed = parseDeckMarkdown('Before {{TimeSeries ids="UNRATE" broken=oops}} after')
    expect(parsed.slides[0]?.segments).toEqual([
      {
        type: "markdown",
        text: 'Before {{TimeSeries ids="UNRATE" broken=oops}} after',
      },
    ])
  })

  it("parses inline widgets without breaking paragraph flow", () => {
    const parsed = parseDeckMarkdown('Status: {{Badge text="Draft"}} is visible.')
    expect(parsed.slides[0]?.segments).toEqual([
      { type: "markdown", text: "Status: " },
      {
        type: "widget",
        name: "Badge",
        attrs: { text: "Draft" },
        raw: '{{Badge text="Draft"}}',
        position: "inline",
      },
      { type: "markdown", text: " is visible." },
    ])
  })

  it("parses quoted attrs and escapes", () => {
    expect(parseWidgetAttrs('text="Draft" note="say \\\"hello\\\""')).toEqual({
      text: "Draft",
      note: 'say "hello"',
    })
  })

  it("throws on malformed attrs", () => {
    expect(() => parseWidgetAttrs('text="Draft" broken=oops')).toThrow(/Malformed widget attrs/)
  })

  it("rejects unterminated quoted attrs with a clear malformed-attrs error", () => {
    expect(() => parseWidgetAttrs('foo="bar')).toThrow(/Malformed widget attrs/)
  })

  it("keeps widgets with unterminated attrs as markdown text", () => {
    const parsed = parseDeckMarkdown('Before {{Badge text="Draft}} after')

    expect(parsed.slides[0]?.segments).toEqual([
      {
        type: "markdown",
        text: 'Before {{Badge text="Draft}} after',
      },
    ])
  })
})

describe("deck path helpers", () => {
  it("normalizes separators like workspace.open.path targets", () => {
    expect(normalizeDeckPath(" deck\\intro.md ")).toBe("deck/intro.md")
    expect(normalizeDeckPath("./briefings//weekly.md")).toBe("briefings/weekly.md")
  })

  it("accepts workspace-relative markdown under the configured prefix", () => {
    expect(isDeckMarkdownPath("deck/intro.md")).toBe(true)
    expect(isDeckMarkdownPath("briefings/intro.md", "briefings/")).toBe(true)
    expect(isDeckMarkdownPath("briefings/intro.md", "briefings\\")).toBe(true)
    expect(isDeckMarkdownPath("briefings/intro.md", "./briefings")).toBe(true)
    expect(isDeckMarkdownPath("briefings/intro.md", "briefings//")).toBe(true)
    expect(isDeckMarkdownPath("./briefings//intro.md", "briefings//")).toBe(true)
  })

  it("rejects absolute paths, parent traversal, and non-markdown files", () => {
    expect(isDeckMarkdownPath("/deck/intro.md")).toBe(false)
    expect(isDeckMarkdownPath("../deck/intro.md")).toBe(false)
    expect(isDeckMarkdownPath("deck/intro.txt")).toBe(false)
    expect(isDeckMarkdownPath("C:/deck/intro.md")).toBe(false)
  })
})
