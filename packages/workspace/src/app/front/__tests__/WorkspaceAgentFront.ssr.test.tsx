// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../front/components/CommandPalette", () => ({ CommandPalette: () => null }))
vi.mock("../../../front/plugin/PluginInspector", () => ({ PluginInspector: () => null }))
import type { WorkspaceChatPanelProps } from "../../../front/chrome/chat/types"
import { WorkspaceAgentFront } from "../WorkspaceAgentFront"

describe("WorkspaceAgentFront server rendering", () => {
  it("renders its session source commit path without browser globals", () => {
    const session = { id: "server-session", title: "Server session" }
    const ChatPanel = (props: WorkspaceChatPanelProps) => <div>Chat {props.sessionId}</div>

    const html = renderToStaticMarkup(
      <WorkspaceAgentFront
        workspaceId="server-workspace"
        chatPanel={ChatPanel}
        persistenceEnabled={false}
        useSessions={(options) => ({
          sourceIdentity: options.sourceIdentity,
          sessions: [session],
          activeSession: session,
          activeSessionId: session.id,
          loading: false,
          create: vi.fn(),
          switch: vi.fn(),
          delete: vi.fn(),
        })}
      />,
    )

    expect(html).toContain("Server session")
    expect(html).not.toContain("Loading sessions…")
  })
})
