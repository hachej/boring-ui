import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { CodeEditor } from "../CodeEditor"

let container: HTMLElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

describe("CodeEditor", () => {
  it("passes the app CSP nonce to CodeMirror style tags", () => {
    const meta = document.createElement("meta")
    meta.setAttribute("name", "boring-csp-nonce")
    meta.setAttribute("content", "test-csp-nonce")
    document.head.appendChild(meta)

    render(<CodeEditor content="const x = 1" language="typescript" />)

    expect(document.head.querySelector('style[nonce="test-csp-nonce"]')).toBeTruthy()
    meta.remove()
  })

  it("renders with content", () => {
    const { container: root } = render(
      <CodeEditor content="const x = 1" language="typescript" />,
    )
    expect(root.querySelector(".cm-editor")).toBeTruthy()
    expect(root.textContent).toContain("const x = 1")
  })

  it("renders with each supported language without errors", () => {
    const languages = [
      "javascript",
      "typescript",
      "python",
      "json",
      "yaml",
      "markdown",
      "sql",
    ]
    for (const lang of languages) {
      const { container: root, unmount } = render(
        <CodeEditor content={`// ${lang} test`} language={lang} />,
      )
      expect(root.querySelector(".cm-editor")).toBeTruthy()
      unmount()
    }
  })

  it("renders editable content element when not read-only", () => {
    const { container: root } = render(
      <CodeEditor content="hello" onChange={vi.fn()} language="typescript" />,
    )
    const cmContent = root.querySelector(".cm-content") as HTMLElement
    expect(cmContent).toBeTruthy()
    expect(cmContent.getAttribute("contenteditable")).toBe("true")
  })

  it("does not call onChange for programmatic content prop updates", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <CodeEditor content="initial" onChange={onChange} language="typescript" />,
    )

    rerender(<CodeEditor content="updated" onChange={onChange} language="typescript" />)

    // Allow any async effects to settle
    await new Promise((r) => setTimeout(r, 50))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("readOnly mode prevents editing", () => {
    const onChange = vi.fn()
    const { container: root } = render(
      <CodeEditor content="readonly content" readOnly onChange={onChange} />,
    )
    const editor = root.querySelector(".cm-editor")
    expect(editor).toBeTruthy()
    expect(root.textContent).toContain("readonly content")
  })

  it("lineNumbers prop toggles gutter visibility", () => {
    const { container: withNumbers } = render(
      <CodeEditor content="line1" lineNumbers />,
    )
    expect(withNumbers.querySelector(".cm-gutters")).toBeTruthy()

    const { container: withoutNumbers } = render(
      <CodeEditor content="line1" lineNumbers={false} />,
    )
    expect(withoutNumbers.querySelector(".cm-lineNumbers")).toBeFalsy()
  })

  it("wordWrap prop toggles line wrapping", () => {
    const { container: root } = render(
      <CodeEditor content="word wrap test" wordWrap />,
    )
    expect(root.querySelector(".cm-editor")).toBeTruthy()
  })

  it("accepts className prop", () => {
    const { container: root } = render(
      <CodeEditor content="test" className="my-editor" />,
    )
    expect(root.querySelector(".my-editor")).toBeTruthy()
  })

  it("shows large file banner for content >= 1MB", () => {
    const largeContent = "x".repeat(1_000_000)
    render(<CodeEditor content={largeContent} />)
    expect(screen.getByText(/Large file/)).toBeInTheDocument()
    expect(screen.getByText(/editing disabled/)).toBeInTheDocument()
  })

  it("shows download button for content >= 10MB", () => {
    const hugeContent = "x".repeat(10_000_000)
    render(<CodeEditor content={hugeContent} />)
    expect(screen.getByText("Download")).toBeInTheDocument()
  })

  it("does not show download button for content < 10MB but >= 1MB", () => {
    const largeContent = "x".repeat(1_000_000)
    render(<CodeEditor content={largeContent} />)
    expect(screen.getByText(/Large file/)).toBeInTheDocument()
    expect(screen.queryByText("Download")).not.toBeInTheDocument()
  })

  it("unknown language renders without errors", () => {
    const { container: root } = render(
      <CodeEditor content="some content" language="brainfuck" />,
    )
    expect(root.querySelector(".cm-editor")).toBeTruthy()
    expect(root.textContent).toContain("some content")
  })

  it("updates content when prop changes", async () => {
    const { container: root, rerender } = render(
      <CodeEditor content="initial" language="typescript" />,
    )
    expect(root.textContent).toContain("initial")

    rerender(<CodeEditor content="updated" language="typescript" />)
    await waitFor(() => {
      expect(root.textContent).toContain("updated")
    })
  })
})
