// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  ComposerContributionProvider,
  useComposerContributions,
  type ComposerContribution,
} from "../composerContributions"

function Probe() {
  const contributions = useComposerContributions()
  return <output>{contributions.map((entry) => entry.id).join(",")}</output>
}

function contribution(id: string): ComposerContribution {
  return { id, Top: () => <div>{id}</div> }
}

describe("ComposerContributionProvider", () => {
  it("composes nested contributions with the nearest provider first", () => {
    render(
      <ComposerContributionProvider contribution={contribution("outer")}>
        <ComposerContributionProvider contribution={contribution("inner")}>
          <Probe />
        </ComposerContributionProvider>
      </ComposerContributionProvider>,
    )

    expect(screen.getByText("inner,outer")).toBeTruthy()
  })

  it("replaces an outer contribution with the same stable id", () => {
    render(
      <ComposerContributionProvider contribution={contribution("same")}>
        <ComposerContributionProvider contribution={{ id: "same", Action: () => <button>inner</button> }}>
          <Probe />
        </ComposerContributionProvider>
      </ComposerContributionProvider>,
    )

    expect(screen.getByText("same")).toBeTruthy()
  })
})
