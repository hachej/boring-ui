import { render, renderHook, screen, waitFor } from "@testing-library/react"
import { useEffect, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  buildFullPagePanelHref,
  useFullPagePanelHref,
  usePanelRenderMode,
  type PanelConfig,
  type PaneProps,
} from "../../../index"
import { WorkspaceProvider } from "../../../front/provider"
import {
  FULL_PAGE_PANEL_INVALID_PARAMS_JSON,
  FULL_PAGE_PANEL_MISSING_COMPONENT,
  FULL_PAGE_PANEL_NOT_SUPPORTED,
  FULL_PAGE_PANEL_RENDER_FAILED,
  parseFullPagePanelLocation,
  WorkspaceFullPagePanel,
} from "../index"

function FullPageAwarePanel({ params, api }: PaneProps<{ path?: string }>) {
  const mode = usePanelRenderMode()

  useEffect(() => {
    api.setTitle(`Deck: ${params.path ?? "none"}`)
  }, [api, params.path])

  return (
    <div>
      <div data-testid="render-mode">{mode}</div>
      <div data-testid="full-page-path">{params.path ?? "none"}</div>
    </div>
  )
}

const fullPagePanel: PanelConfig<{ path?: string }> = {
  id: "deck",
  title: "Deck",
  component: FullPageAwarePanel,
  supportsFullPage: true,
}

const dockOnlyPanel: PanelConfig = {
  id: "dock-only",
  title: "Dock Only",
  component: () => <div>dock only</div>,
}

const crashingPanel: PanelConfig = {
  id: "crashy",
  title: "Crashy",
  component: (_props: PaneProps) => {
    throw new Error("boom")
  },
  supportsFullPage: true,
}

describe("full-page panel helpers", () => {
  it("builds and reads a configured full-page href", () => {
    expect(
      buildFullPagePanelHref({
        componentId: "deck",
        params: { path: "deck/intro.md" },
        basePath: "/full-page",
      }),
    ).toBe("/full-page?component=deck&params=%7B%22path%22%3A%22deck%2Fintro.md%22%7D")

    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkspaceProvider persistenceEnabled={false} fullPageBasePath="/full-page">
        {children}
      </WorkspaceProvider>
    )

    const { result } = renderHook(
      () => useFullPagePanelHref({ componentId: "deck", params: { path: "deck/intro.md" } }),
      { wrapper },
    )

    expect(result.current).toBe("/full-page?component=deck&params=%7B%22path%22%3A%22deck%2Fintro.md%22%7D")
  })
})

describe("parseFullPagePanelLocation", () => {
  it("returns stable errors for invalid requests", () => {
    expect(parseFullPagePanelLocation("")).toEqual({
      componentId: null,
      params: {},
      error: {
        code: FULL_PAGE_PANEL_MISSING_COMPONENT,
        message: "Missing full-page panel component id.",
      },
    })

    expect(parseFullPagePanelLocation("?component=deck&params=not-json")).toEqual({
      componentId: null,
      params: {},
      error: {
        code: FULL_PAGE_PANEL_INVALID_PARAMS_JSON,
        message: "Invalid full-page panel params JSON.",
      },
    })
  })
})

describe("WorkspaceFullPagePanel", () => {
  it("renders an opted-in panel in full-page mode", async () => {
    render(
      <WorkspaceProvider persistenceEnabled={false} manageDocumentTitle={false} panels={[fullPagePanel]}>
        <WorkspaceFullPagePanel componentId="deck" params={{ path: "deck/intro.md" }} />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("render-mode")).toHaveTextContent("full-page")
    expect(screen.getByTestId("full-page-path")).toHaveTextContent("deck/intro.md")
    await waitFor(() => expect(document.title).toBe("Deck: deck/intro.md"))
  })

  it("rejects panels that do not opt into full-page mode", () => {
    render(
      <WorkspaceProvider persistenceEnabled={false} manageDocumentTitle={false} panels={[dockOnlyPanel]}>
        <WorkspaceFullPagePanel componentId="dock-only" />
      </WorkspaceProvider>,
    )

    expect(screen.getByTestId("full-page-error-state")).toHaveAttribute("data-full-page-error-code", FULL_PAGE_PANEL_NOT_SUPPORTED)
  })

  it("surfaces a stable full-page render error when the panel crashes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(
        <WorkspaceProvider persistenceEnabled={false} manageDocumentTitle={false} panels={[crashingPanel]}>
          <WorkspaceFullPagePanel componentId="crashy" />
        </WorkspaceProvider>,
      )

      await waitFor(() => {
        expect(screen.getByTestId("full-page-error-state")).toHaveAttribute(
          "data-full-page-error-code",
          FULL_PAGE_PANEL_RENDER_FAILED,
        )
      })
    } finally {
      errorSpy.mockRestore()
    }
  })
})
