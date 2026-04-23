import { useEffect, type ReactNode } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { ChatPanel as ClassicChatPanelComponent } from "../src/front/ChatPanel"
import { ChatPanel as ShadcnChatPanelComponent } from "../src/front-shadcn/ChatPanel"

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

      if (url.pathname === "/api/v1/agent/chat") {
        return new Response(null, { status: 204 })
      }

      if (url.pathname.startsWith("/api/v1/agent/sessions/")) {
        return new Response(null, { status: 204 })
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
