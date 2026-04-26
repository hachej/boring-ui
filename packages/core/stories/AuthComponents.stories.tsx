import type { Meta, StoryObj } from "@storybook/react"
import { createElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { UserMenu } from "../src/front/components/UserMenu"
import { ThemeToggle } from "../src/front/components/ThemeToggle"
import { WorkspaceSwitcher } from "../src/front/components/WorkspaceSwitcher"
import { ThemeProvider } from "../src/front/ThemeProvider"
import { AuthContextWrapper, withAuthDecorator } from "./auth-decorators"

function MockWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

const withFullProviders = (Story: React.FC) =>
  createElement(
    MockWorkspaceProvider,
    null,
    createElement(AuthContextWrapper, null,
      createElement(ThemeProvider, null,
        createElement(MemoryRouter, null,
          createElement(Story),
        ),
      ),
    ),
  )

// ─── UserMenu ────────────────────────────────────────────────────────

const userMenuMeta: Meta<typeof UserMenu> = {
  title: "Auth/UserMenu",
  component: UserMenu,
  tags: ["autodocs"],
  decorators: [withFullProviders],
  parameters: { layout: "centered" },
}

export default userMenuMeta

export const Default: StoryObj<typeof UserMenu> = {}

// ─── ThemeToggle ─────────────────────────────────────────────────────

export const ThemeToggleDefault: StoryObj<typeof ThemeToggle> = {
  render: () => <ThemeToggle />,
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: { layout: "centered" },
}

export const ThemeToggleDark: StoryObj<typeof ThemeToggle> = {
  render: () => <ThemeToggle />,
  decorators: [
    (Story) => (
      <ThemeProvider defaultTheme="dark">
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: { layout: "centered" },
}

// ─── WorkspaceSwitcher ───────────────────────────────────────────────

export const WorkspaceSwitcherEmpty: StoryObj<typeof WorkspaceSwitcher> = {
  render: () => <WorkspaceSwitcher />,
  decorators: [withFullProviders],
  parameters: { layout: "centered" },
}
