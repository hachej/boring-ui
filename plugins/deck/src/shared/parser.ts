import type { DeckSegment, ParsedDeck, ParsedSlide } from "./types"

const TITLE_RX = /^##\s+title:\s*(.+)$/i
const YAML_TITLE_RX = /^title:\s*(.+)$/i
const YAML_KV_RX = /^[A-Za-z][\w-]*:\s*.*$/
const FENCE_RX = /^(```|~~~)/
const WIDGET_OPEN = "{{"
const WIDGET_CLOSE = "}}"
const WIDGET_NAME_RX = /^[A-Za-z][\w-]*$/
const ATTR_KEY_RX = /^[A-Za-z][\w-]*$/

export function splitSlides(input: string): string[] {
  const slides: string[] = []
  let current: string[] = []
  let fenceMarker: string | null = null

  for (const line of input.split("\n")) {
    const trimmed = line.trim()
    const fence = FENCE_RX.exec(trimmed)
    if (fence) {
      if (fenceMarker === fence[1]) fenceMarker = null
      else if (fenceMarker === null) fenceMarker = fence[1]
    }

    if (fenceMarker === null && trimmed === "---") {
      slides.push(current.join("\n").trim())
      current = []
      continue
    }

    current.push(line)
  }

  slides.push(current.join("\n").trim())

  const nonEmpty = slides.filter((slide) => slide.length > 0)
  if (nonEmpty.length > 0) return nonEmpty
  return [""]
}

export function parseWidgetAttrs(raw: string): Record<string, string> {
  const parsed = tryParseWidgetAttrs(raw)
  if (parsed == null) throw new Error(`Malformed widget attrs: ${raw}`)
  return parsed
}

export function parseDeckMarkdown(input: string): ParsedDeck {
  const lines = input.split("\n")
  let start = 0
  while (start < lines.length && lines[start].trim() === "") start += 1

  let title = stripYamlFrontmatter(lines, start)

  while (start < lines.length && lines[start].trim() === "") start += 1
  if (!title && lines[start]?.trim() === "---") {
    lines.splice(start, 1)
  }

  let sawFence = false
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (FENCE_RX.test(trimmed)) sawFence = !sawFence
    if (!sawFence && trimmed === "---") break
    const match = TITLE_RX.exec(trimmed)
    if (match) {
      title = title ?? stripQuotes(match[1].trim())
      lines.splice(i, 1)
      if (lines[i]?.trim() === "") lines.splice(i, 1)
      break
    }
  }

  const slides = splitSlides(lines.join("\n")).map<ParsedSlide>((raw, index, all) => ({
    index,
    raw,
    segments: tokenize(raw, index, all.length),
  }))

  return title ? { title, slides } : { slides }
}

function stripYamlFrontmatter(lines: string[], start: number): string | undefined {
  if (lines[start]?.trim() !== "---") return undefined
  let end = -1
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return undefined

  const fields = lines.slice(start + 1, end)
  if (fields.length === 0 || !fields.every((line) => YAML_KV_RX.test(line.trim()))) return undefined

  const titleLine = fields.find((line) => YAML_TITLE_RX.test(line.trim()))
  const title = titleLine?.trim().match(YAML_TITLE_RX)?.[1]?.trim()
  lines.splice(start, end - start + 1)
  while (start < lines.length && lines[start]?.trim() === "") lines.splice(start, 1)
  return title ? stripQuotes(title) : undefined
}

function tokenize(markdown: string, slideIndex: number, slideCount: number): DeckSegment[] {
  const segments: DeckSegment[] = []
  const lines = markdown.split("\n")
  let fenceMarker: string | null = null

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const trimmed = line.trim()
    const fence = FENCE_RX.exec(trimmed)
    if (fence) {
      if (fenceMarker === fence[1]) fenceMarker = null
      else if (fenceMarker === null) fenceMarker = fence[1]
      pushMarkdown(segments, line)
      if (lineIndex < lines.length - 1) pushMarkdown(segments, "\n")
      continue
    }

    if (fenceMarker) {
      pushMarkdown(segments, line)
      if (lineIndex < lines.length - 1) pushMarkdown(segments, "\n")
      continue
    }

    for (const segment of tokenizeLine(line, slideIndex, slideCount)) {
      if (segment.type === "markdown") pushMarkdown(segments, segment.text)
      else segments.push(segment)
    }
    if (lineIndex < lines.length - 1) pushMarkdown(segments, "\n")
  }

  return segments.length > 0 ? segments : [{ type: "markdown", text: "" }]
}

function tokenizeLine(line: string, _slideIndex: number, _slideCount: number): DeckSegment[] {
  const segments: DeckSegment[] = []
  let markdown = ""
  let i = 0

  while (i < line.length) {
    if (line[i] === "`") {
      const tickCount = countRepeated(line, i, "`")
      const close = line.indexOf("`".repeat(tickCount), i + tickCount)
      if (close === -1) {
        markdown += line.slice(i)
        break
      }
      markdown += line.slice(i, close + tickCount)
      i = close + tickCount
      continue
    }

    if (line.startsWith(WIDGET_OPEN, i)) {
      const close = line.indexOf(WIDGET_CLOSE, i + WIDGET_OPEN.length)
      if (close === -1) {
        markdown += line.slice(i)
        break
      }
      const raw = line.slice(i, close + WIDGET_CLOSE.length)
      const parsed = parseWidget(raw, line)
      if (!parsed) {
        markdown += raw
        i = close + WIDGET_CLOSE.length
        continue
      }
      if (markdown) {
        segments.push({ type: "markdown", text: markdown })
        markdown = ""
      }
      segments.push(parsed)
      i = close + WIDGET_CLOSE.length
      continue
    }

    markdown += line[i]
    i += 1
  }

  if (markdown) segments.push({ type: "markdown", text: markdown })
  return segments
}

function parseWidget(raw: string, line: string): Extract<DeckSegment, { type: "widget" }> | null {
  const inner = raw.slice(WIDGET_OPEN.length, -WIDGET_CLOSE.length).trim()
  if (!inner) return null

  const firstSpace = inner.search(/\s/)
  const name = firstSpace === -1 ? inner : inner.slice(0, firstSpace)
  const attrsRaw = firstSpace === -1 ? "" : inner.slice(firstSpace).trim()

  if (!WIDGET_NAME_RX.test(name)) return null

  let attrs: Record<string, string>
  try {
    attrs = attrsRaw ? parseWidgetAttrs(attrsRaw) : {}
  } catch {
    return null
  }

  return {
    type: "widget",
    name,
    attrs,
    raw,
    position: line.trim() === raw.trim() ? "block" : "inline",
  }
}

function tryParseWidgetAttrs(raw: string): Record<string, string> | null {
  const attrs: Record<string, string> = {}
  let i = 0

  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i])) i += 1
    if (i >= raw.length) break

    const keyStart = i
    while (i < raw.length && /[A-Za-z0-9_-]/.test(raw[i])) i += 1
    const key = raw.slice(keyStart, i)
    if (!ATTR_KEY_RX.test(key)) return null

    while (i < raw.length && /\s/.test(raw[i])) i += 1
    if (raw[i] !== "=") return null
    i += 1
    while (i < raw.length && /\s/.test(raw[i])) i += 1
    if (raw[i] !== '"') return null
    i += 1

    let value = ""
    let closed = false
    while (i < raw.length) {
      const char = raw[i]
      if (char === "\\") {
        const next = raw[i + 1]
        if (next === undefined) return null
        value += next
        i += 2
        continue
      }
      if (char === '"') {
        i += 1
        closed = true
        break
      }
      value += char
      i += 1
    }
    if (!closed) return null

    attrs[key] = value
  }

  while (i < raw.length && /\s/.test(raw[i])) i += 1
  if (i !== raw.length) return null
  return attrs
}

function pushMarkdown(segments: DeckSegment[], text: string) {
  if (text.length === 0) return
  const last = segments[segments.length - 1]
  if (last?.type === "markdown") last.text += text
  else segments.push({ type: "markdown", text })
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "")
}

function countRepeated(value: string, start: number, needle: string): number {
  let count = 0
  while (value[start + count] === needle) count += 1
  return count
}
