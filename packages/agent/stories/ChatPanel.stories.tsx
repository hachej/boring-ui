import { useEffect, type ReactNode } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { ChatPanel as ClassicChatPanelComponent } from "../src/front/ChatPanel"
import { ChatPanel as ShadcnChatPanelComponent } from "../src/front/ChatPanel"

const frameClass =
  "h-[680px] w-full max-w-[720px] overflow-hidden rounded-md border border-border bg-background"

function MockAgentApiProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "http://localhost",
      )

      if (url.pathname === "/api/v1/agent/models") {
        return Response.json({
          models: [{ provider: "pi", id: "default", label: "Pi default", available: true }],
          defaultModel: { provider: "pi", id: "default" },
        })
      }

      if (url.pathname === "/api/v1/agent/skills") {
        return Response.json({ skills: [] })
      }

      if (url.pathname === "/api/v1/agent/chat") {
        return new Response(null, { status: 204 })
      }

      if (url.pathname.startsWith("/api/v1/agent/chat/") && url.pathname.endsWith("/messages")) {
        return Response.json({ messages: [] })
      }

      if (url.pathname.startsWith("/api/v1/agent/sessions/")) {
        return Response.json({ id: url.pathname.split("/").at(-1), title: "Storybook session" })
      }

      return originalFetch(input, init)
    }

    return () => {
      globalThis.fetch = originalFetch
    }
  }, [])

  return <>{children}</>
}

const meta: Meta = {
  title: "Agent/ChatPanel",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <MockAgentApiProvider>
        <Story />
      </MockAgentApiProvider>
    ),
  ],
}

export default meta
type Story = StoryObj

export const ClassicChatPanel: Story = {
  render: () => (
    <div className={frameClass}>
      <ClassicChatPanelComponent sessionId="storybook-classic-session" />
    </div>
  ),
}

export const ShadcnChatPanel: Story = {
  render: () => (
    <div className={frameClass}>
      <ShadcnChatPanelComponent sessionId="storybook-shadcn-session" />
    </div>
  ),
}
