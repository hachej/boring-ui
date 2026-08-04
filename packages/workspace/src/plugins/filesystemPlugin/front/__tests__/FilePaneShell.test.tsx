import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FilePaneShell } from "../FilePaneShell"

function Editor() {
  return <div>editor</div>
}

function renderShell(path: string) {
  return render(
    <FilePaneShell
      path={path}
      content="content"
      isLoading={false}
      error={null}
      conflict={null}
      onChange={vi.fn()}
      onReload={vi.fn()}
      onOverwrite={vi.fn()}
      editorComponent={Editor}
    />,
  )
}

describe("FilePaneShell path header", () => {
  it("renders a governed relative breadcrumb with the filename emphasized", () => {
    renderShell("src/features/editor.tsx")

    const breadcrumb = screen.getByRole("navigation", { name: "File path: src/features/editor.tsx" })
    expect(breadcrumb).toHaveAttribute("data-boring-workspace-part", "file-path-header")
    expect(breadcrumb).toHaveTextContent("Workspace")
    expect(breadcrumb).toHaveTextContent("src")
    expect(breadcrumb).toHaveTextContent("features")
    expect(breadcrumb).toHaveTextContent("editor.tsx")
    expect(screen.getByText("editor.tsx")).toHaveClass("font-medium")
  })

  it("does not disclose host directory segments from an accidental absolute path", () => {
    renderShell("/home/runner/private/project/secret.ts")

    expect(screen.getByRole("navigation", { name: "File path: secret.ts" })).toBeInTheDocument()
    expect(screen.queryByText("home")).not.toBeInTheDocument()
    expect(screen.queryByText("private")).not.toBeInTheDocument()
  })
})
