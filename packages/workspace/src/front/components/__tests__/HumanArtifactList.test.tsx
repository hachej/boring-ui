import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { HumanArtifact } from "../../../shared/artifacts"
import { HumanArtifactList } from "../HumanArtifactList"

function artifacts(count: number): HumanArtifact[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `artifact-${index + 1}`,
    surfaceKind: "file",
    target: `docs/artifact-${index + 1}.md`,
    title: `Artifact ${index + 1}`,
    description: `Description ${index + 1}`,
  }))
}

describe("HumanArtifactList", () => {
  it("renders nothing for an empty collection", () => {
    const { container } = render(<HumanArtifactList artifacts={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("opens available artifacts and keeps unavailable artifacts disabled", async () => {
    const user = userEvent.setup()
    const items = artifacts(2)
    const onOpen = vi.fn()
    render(<HumanArtifactList artifacts={items} onOpen={onOpen} unavailableArtifactIds={new Set(["artifact-2"])} />)

    await user.click(screen.getByRole("button", { name: "Open Artifact 1" }))
    expect(onOpen).toHaveBeenCalledWith(items[0])
    expect(screen.getByText("Document", { selector: "span" })).toBeInTheDocument()
    expect(screen.getByText("docs/artifact-1.md")).toBeInTheDocument()
    expect(screen.queryByText("file")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Artifact 2/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Artifact 2 unavailable")).toHaveTextContent("Unavailable")
  })

  it("keeps document paths visible when callers customize the badge label", () => {
    render(<HumanArtifactList artifacts={artifacts(1)} typeLabel="Attachment" />)
    expect(screen.getByText("Attachment")).toBeInTheDocument()
    expect(screen.getByText("docs/artifact-1.md")).toBeInTheDocument()
  })

  it("shows ten rows initially and expands/collapses the remainder", async () => {
    const user = userEvent.setup()
    render(<HumanArtifactList artifacts={artifacts(11)} onOpen={vi.fn()} />)

    expect(screen.getAllByRole("listitem")).toHaveLength(10)
    await user.click(screen.getByRole("button", { name: "Show 1 more" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(11)
    await user.click(screen.getByRole("button", { name: "Show less" }))
    expect(screen.getAllByRole("listitem")).toHaveLength(10)
  })
})
