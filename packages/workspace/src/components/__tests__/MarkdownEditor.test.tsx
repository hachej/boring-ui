import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MarkdownEditor, sanitizeHtml, isSafeUrl } from "../MarkdownEditor"

describe("MarkdownEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders with content", async () => {
    render(<MarkdownEditor content="Hello world" />)
    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument()
    })
  })

  it("renders toolbar with formatting buttons", async () => {
    render(<MarkdownEditor content="test" />)
    await waitFor(() => {
      expect(screen.getByRole("toolbar")).toBeInTheDocument()
    })
    expect(screen.getByTitle("Bold")).toBeInTheDocument()
    expect(screen.getByTitle("Italic")).toBeInTheDocument()
    expect(screen.getByTitle("Underline")).toBeInTheDocument()
    expect(screen.getByTitle("Strikethrough")).toBeInTheDocument()
    expect(screen.getByTitle("Heading 1")).toBeInTheDocument()
    expect(screen.getByTitle("Heading 2")).toBeInTheDocument()
    expect(screen.getByTitle("Heading 3")).toBeInTheDocument()
    expect(screen.getByTitle("Bullet list")).toBeInTheDocument()
    expect(screen.getByTitle("Ordered list")).toBeInTheDocument()
    expect(screen.getByTitle("Task list")).toBeInTheDocument()
    expect(screen.getByTitle("Quote")).toBeInTheDocument()
    expect(screen.getByTitle("Code block")).toBeInTheDocument()
    expect(screen.getByTitle("Link")).toBeInTheDocument()
    expect(screen.getByTitle("Image")).toBeInTheDocument()
    expect(screen.getByTitle("Highlight")).toBeInTheDocument()
    expect(screen.getByTitle("Horizontal rule")).toBeInTheDocument()
  })

  it("hides toolbar in readOnly mode", async () => {
    render(<MarkdownEditor content="read only" readOnly />)
    await waitFor(() => {
      expect(screen.getByText("read only")).toBeInTheDocument()
    })
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument()
  })

  it("renders with readOnly making editor non-editable", async () => {
    render(<MarkdownEditor content="read only" readOnly />)
    await waitFor(() => {
      expect(screen.getByText("read only")).toBeInTheDocument()
    })
    const editorEl = document.querySelector("[contenteditable]")
    expect(editorEl?.getAttribute("contenteditable")).toBe("false")
  })

  it("accepts className prop", () => {
    const { container } = render(
      <MarkdownEditor content="test" className="custom-editor" />,
    )
    expect(container.querySelector(".custom-editor")).toBeTruthy()
  })

  it("loads all 10 extensions without error", async () => {
    render(<MarkdownEditor content="extension test" />)
    await waitFor(() => {
      expect(screen.getByText("extension test")).toBeInTheDocument()
    })
  })

  it("sanitizes script tags from HTML", () => {
    const result = sanitizeHtml('<p>Hello</p><script>alert("xss")</script>')
    expect(result).not.toContain("<script")
    expect(result).toContain("<p>Hello</p>")
  })

  it("sanitizes onclick handlers from HTML", () => {
    const result = sanitizeHtml('<div onclick="alert(1)">test</div>')
    expect(result).not.toContain("onclick")
  })

  it("sanitizes quoted javascript: URLs from HTML", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>')
    expect(result).not.toContain("javascript:")
  })

  it("sanitizes unquoted javascript: URLs from HTML", () => {
    const result = sanitizeHtml("<a href=javascript:alert(1)>click</a>")
    expect(result).not.toContain("javascript:")
  })

  it("sanitizes unquoted javascript: src from HTML", () => {
    const result = sanitizeHtml("<img src=javascript:alert(1) />")
    expect(result).not.toContain("javascript:")
  })

  it("sanitizes iframe tags from HTML", () => {
    const result = sanitizeHtml('<p>Before</p><iframe src="evil.com"></iframe><p>After</p>')
    expect(result).not.toContain("<iframe")
    expect(result).toContain("<p>Before</p>")
    expect(result).toContain("<p>After</p>")
  })

  it("preserves clean HTML formatting", () => {
    const html = "<p><strong>Bold</strong> and <em>italic</em></p>"
    expect(sanitizeHtml(html)).toBe(html)
  })

  it("isSafeUrl blocks javascript: URLs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeUrl("  JavaScript:alert(1)")).toBe(false)
    expect(isSafeUrl("data:text/html,<script>alert(1)</script>")).toBe(false)
  })

  it("isSafeUrl allows safe URLs", () => {
    expect(isSafeUrl("https://example.com")).toBe(true)
    expect(isSafeUrl("http://example.com/image.png")).toBe(true)
    expect(isSafeUrl("/relative/path")).toBe(true)
    expect(isSafeUrl("data:image/png;base64,abc")).toBe(true)
  })

  it("renders with custom placeholder", async () => {
    render(<MarkdownEditor content="" placeholder="Type here..." />)
    await waitFor(() => {
      const el = document.querySelector("[data-placeholder]")
      expect(el).toBeTruthy()
    })
  })

  it("updates content when prop changes", async () => {
    const { rerender } = render(<MarkdownEditor content="first" />)
    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument()
    })
    rerender(<MarkdownEditor content="second" />)
    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument()
    })
  })

  it("does not call onChange for programmatic content prop updates", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditor content="initial" onChange={onChange} />,
    )
    await waitFor(() => {
      expect(screen.getByText("initial")).toBeInTheDocument()
    })
    onChange.mockClear()
    rerender(<MarkdownEditor content="updated" onChange={onChange} />)
    await waitFor(() => {
      expect(screen.getByText("updated")).toBeInTheDocument()
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
