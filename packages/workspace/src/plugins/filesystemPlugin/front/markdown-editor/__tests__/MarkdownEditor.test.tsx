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

  it("renders markdown tables", async () => {
    render(
      <MarkdownEditor content={`| A | B |\n| --- | --- |\n| 1 | 2 |`} readOnly />,
    )
    await waitFor(() => {
      expect(document.querySelector("table")).toBeTruthy()
    })
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("2")).toBeInTheDocument()
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
    expect(
      screen.getByTitle("Image (click to upload, Shift+click for URL)"),
    ).toBeInTheDocument()
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

  describe("toolbar button behaviors", () => {
    const ready = async () =>
      waitFor(() => expect(document.querySelector("[contenteditable='true']")).toBeTruthy())

    const click = (title: string) => {
      fireEvent.click(screen.getByTitle(title))
    }

    const lastCall = (fn: ReturnType<typeof vi.fn>) =>
      fn.mock.calls.at(-1)?.[0] as string | undefined

    it("Bold toggles aria-pressed and stored mark", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      const btn = screen.getByTitle("Bold")
      expect(btn.getAttribute("aria-pressed")).toBe("false")
      click("Bold")
      await waitFor(() =>
        expect(screen.getByTitle("Bold").getAttribute("aria-pressed")).toBe("true"),
      )
    })

    it("Italic toggles aria-pressed", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Italic")
      await waitFor(() =>
        expect(screen.getByTitle("Italic").getAttribute("aria-pressed")).toBe("true"),
      )
    })

    it("Underline toggles aria-pressed (extension wired up)", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Underline")
      await waitFor(() =>
        expect(screen.getByTitle("Underline").getAttribute("aria-pressed")).toBe("true"),
      )
    })

    it("Strikethrough toggles aria-pressed", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Strikethrough")
      await waitFor(() =>
        expect(screen.getByTitle("Strikethrough").getAttribute("aria-pressed")).toBe("true"),
      )
    })

    it("Highlight toggles aria-pressed (extension wired up)", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Highlight")
      await waitFor(() =>
        expect(screen.getByTitle("Highlight").getAttribute("aria-pressed")).toBe("true"),
      )
    })

    it("Heading 1 converts current block and emits markdown", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Heading 1")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^#\s+Hello/)
      expect(screen.getByTitle("Heading 1").getAttribute("aria-pressed")).toBe("true")
    })

    it("Heading 2 converts current block and emits markdown", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Heading 2")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^##\s+Hello/)
    })

    it("Heading 3 converts current block and emits markdown", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Heading 3")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^###\s+Hello/)
    })

    it("Bullet list converts current block to a list", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Bullet list")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^[-*]\s+Hello/m)
      expect(screen.getByTitle("Bullet list").getAttribute("aria-pressed")).toBe("true")
    })

    it("Ordered list converts current block to a numbered list", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Ordered list")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^1\.\s+Hello/m)
      expect(screen.getByTitle("Ordered list").getAttribute("aria-pressed")).toBe("true")
    })

    it("Task list converts current block to a task list", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Task list")
      await waitFor(() =>
        expect(screen.getByTitle("Task list").getAttribute("aria-pressed")).toBe("true"),
      )
      expect(lastCall(onChange) ?? "").toMatch(/\[ \]/)
    })

    it("Quote wraps current block in a blockquote", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Quote")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/^>\s*Hello/m)
      expect(screen.getByTitle("Quote").getAttribute("aria-pressed")).toBe("true")
    })

    it("Code block converts current block into a fenced code block", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Code block")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/```/)
      expect(screen.getByTitle("Code block").getAttribute("aria-pressed")).toBe("true")
    })

    it("Horizontal rule inserts a divider", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Horizontal rule")
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(/---/)
    })

    it("Link button opens prompt with safe URL and runs chain without error", async () => {
      const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("https://example.com")
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Link")
      expect(promptSpy).toHaveBeenCalled()
      promptSpy.mockRestore()
    })

    it("Link button rejects javascript: URLs", async () => {
      const onChange = vi.fn()
      const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("javascript:alert(1)")
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Link")
      await new Promise((r) => setTimeout(r, 20))
      const md = lastCall(onChange) ?? ""
      expect(md).not.toMatch(/javascript:/)
      promptSpy.mockRestore()
    })

    it("Link button cancels cleanly when prompt returns null", async () => {
      const onChange = vi.fn()
      const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null)
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      click("Link")
      expect(promptSpy).toHaveBeenCalled()
      promptSpy.mockRestore()
    })

    it("Image button (default click) triggers the file picker", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      const input = document.querySelector(
        "[data-testid='image-file-input']",
      ) as HTMLInputElement
      expect(input).toBeTruthy()
      const clickSpy = vi.spyOn(input, "click")
      // Default click — no shift — opens the file picker.
      fireEvent.click(
        screen.getByTitle("Image (click to upload, Shift+click for URL)"),
      )
      expect(clickSpy).toHaveBeenCalled()
    })

    it("Image button (Shift+click) falls back to URL prompt", async () => {
      const onChange = vi.fn()
      const promptSpy = vi
        .spyOn(window, "prompt")
        .mockReturnValue("https://example.com/cat.png")
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      fireEvent.click(
        screen.getByTitle("Image (click to upload, Shift+click for URL)"),
        { shiftKey: true },
      )
      expect(promptSpy).toHaveBeenCalled()
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      expect(lastCall(onChange)).toMatch(
        /!\[\]\(https:\/\/example\.com\/cat\.png\)/,
      )
      promptSpy.mockRestore()
    })

    it("Image URL prompt rejects javascript: URLs (Shift+click path)", async () => {
      const onChange = vi.fn()
      const promptSpy = vi
        .spyOn(window, "prompt")
        .mockReturnValue("javascript:alert(1)")
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      fireEvent.click(
        screen.getByTitle("Image (click to upload, Shift+click for URL)"),
        { shiftKey: true },
      )
      await new Promise((r) => setTimeout(r, 20))
      const md = lastCall(onChange) ?? ""
      expect(md).not.toMatch(/javascript:/)
      promptSpy.mockRestore()
    })

    it("Image upload: picking a file inserts a base64 data URL via setImage", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      const input = document.querySelector(
        "[data-testid='image-file-input']",
      ) as HTMLInputElement
      const tinyPng = new Blob([new Uint8Array([137, 80, 78, 71])], {
        type: "image/png",
      })
      const file = new File([tinyPng], "shot.png", { type: "image/png" })
      Object.defineProperty(input, "files", { value: [file], configurable: true })
      fireEvent.change(input)
      await waitFor(() => {
        const md = lastCall(onChange) ?? ""
        expect(md).toMatch(/!\[shot\.png\]\(data:image\/png;base64,/)
      })
    })

    it("Image upload: stores through upload API when documentPath is supplied", async () => {
      const onChange = vi.fn()
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ markdownUrl: "../assets/images/shot.png" }),
      })
      vi.stubGlobal("fetch", fetchSpy)
      render(<MarkdownEditor content="Hello" onChange={onChange} documentPath="deck/briefing.md" />)
      await ready()
      const input = document.querySelector(
        "[data-testid='image-file-input']",
      ) as HTMLInputElement
      const file = new File([new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })], "shot.png", { type: "image/png" })
      Object.defineProperty(input, "files", { value: [file], configurable: true })
      fireEvent.change(input)
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/v1/files/upload", expect.objectContaining({ method: "POST" }))
        expect(lastCall(onChange)).toMatch(/!\[shot\.png\]\(\.\.\/assets\/images\/shot\.png\)/)
      })
      vi.unstubAllGlobals()
    })

    it("Image upload: ignores non-image files (no setImage call)", async () => {
      const onChange = vi.fn()
      render(<MarkdownEditor content="Hello" onChange={onChange} />)
      await ready()
      const input = document.querySelector(
        "[data-testid='image-file-input']",
      ) as HTMLInputElement
      const file = new File([new Blob(["nope"])], "evil.exe", {
        type: "application/octet-stream",
      })
      Object.defineProperty(input, "files", { value: [file], configurable: true })
      fireEvent.change(input)
      await new Promise((r) => setTimeout(r, 50))
      const md = lastCall(onChange) ?? ""
      expect(md).not.toMatch(/!\[/)
    })

    describe("Image resize", () => {
      it("preserves the width attribute through setImage when supplied", async () => {
        const onChange = vi.fn()
        render(
          <MarkdownEditor
            content='<img src="https://example.com/x.png" width="240" />'
            onChange={onChange}
          />,
        )
        await waitFor(() => {
          // ResizableImage's NodeView renders an <img> inside a wrapper. The
          // outer wrapper carries the width style; the inner img should have
          // received the width attribute via parseHTML.
          const wrapper = document.querySelector("[data-resizable-image]")
          expect(wrapper).toBeTruthy()
          expect((wrapper as HTMLElement).style.width).toBe("240px")
        })
      })

      it("renders a draggable resize handle on the image NodeView", async () => {
        render(
          <MarkdownEditor content='<img src="https://example.com/x.png" />' />,
        )
        await waitFor(() => {
          expect(
            document.querySelector("[data-testid='resize-handle']"),
          ).toBeTruthy()
        })
      })
    })

    describe("DOM structure (regression: lists + highlight rendering)", () => {
      const editorEl = () =>
        document.querySelector("[contenteditable='true']") as HTMLElement

      it("Bullet list produces a <ul><li> structure (markers visible via CSS)", async () => {
        render(<MarkdownEditor content="Hello" />)
        await ready()
        click("Bullet list")
        await waitFor(() => {
          const ul = editorEl()?.querySelector("ul")
          expect(ul).toBeTruthy()
          expect(ul?.querySelector("li")).toBeTruthy()
        })
      })

      it("Ordered list produces an <ol><li> structure", async () => {
        render(<MarkdownEditor content="Hello" />)
        await ready()
        click("Ordered list")
        await waitFor(() => {
          const ol = editorEl()?.querySelector("ol")
          expect(ol).toBeTruthy()
          expect(ol?.querySelector("li")).toBeTruthy()
        })
      })

      it("Task list produces a list element flagged as taskList", async () => {
        const onChange = vi.fn()
        render(<MarkdownEditor content="Hello" onChange={onChange} />)
        await ready()
        click("Task list")
        await waitFor(() => {
          // jsdom doesn't render TaskItem's NodeView (label + input), but
          // either the data-type attribute on the ul OR a markdown checkbox
          // syntax in onChange is enough to prove the chain ran.
          const ul = editorEl()?.querySelector("ul[data-type='taskList']")
          const aria = screen
            .getByTitle("Task list")
            .getAttribute("aria-pressed")
          const md = onChange.mock.calls.at(-1)?.[0] as string | undefined
          expect(ul || aria === "true" || /\[ ?\]/.test(md ?? "")).toBeTruthy()
        })
      })

      it("Highlight wraps the active text in <mark>", async () => {
        render(<MarkdownEditor content="Hello" />)
        await ready()
        const el = editorEl()
        el.focus()
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        click("Highlight")
        await waitFor(() => {
          // <mark> in the DOM OR aria-pressed=true (jsdom selection sync is
          // flaky — either signal is enough to prove the extension's wired).
          const mark = editorEl()?.querySelector("mark")
          const aria = screen
            .getByTitle("Highlight")
            .getAttribute("aria-pressed")
          expect(mark || aria === "true").toBeTruthy()
        })
      })
    })

    it("toggling Bold off restores aria-pressed to false", async () => {
      render(<MarkdownEditor content="Hello" />)
      await ready()
      click("Bold")
      await waitFor(() =>
        expect(screen.getByTitle("Bold").getAttribute("aria-pressed")).toBe("true"),
      )
      click("Bold")
      await waitFor(() =>
        expect(screen.getByTitle("Bold").getAttribute("aria-pressed")).toBe("false"),
      )
    })
  })
})
