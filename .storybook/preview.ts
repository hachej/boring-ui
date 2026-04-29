import type { Preview } from "@storybook/react"
import { INITIAL_VIEWPORTS } from "@storybook/addon-viewport"
import { createElement } from "react"
import "../packages/workspace/src/globals.css"
import "../packages/agent/src/front/styles/globals.css"

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Global theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  parameters: {
    actions: {
      argTypesRegex: "^on[A-Z].*",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    viewport: {
      viewports: {
        ...INITIAL_VIEWPORTS,
        mobile: {
          name: "Mobile 375x667",
          styles: { width: "375px", height: "667px" },
          type: "mobile",
        },
        tablet: {
          name: "Tablet 800x600",
          styles: { width: "800px", height: "600px" },
          type: "tablet",
        },
        desktop: {
          name: "Desktop 1440x900",
          styles: { width: "1440px", height: "900px" },
          type: "desktop",
        },
      },
    },
    layout: "fullscreen",
  },
  decorators: [
    (Story, context) => {
      const isDark = context.globals.theme === "dark"
      document.documentElement.classList.toggle("dark", isDark)
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light")

      return createElement(
        "div",
        { className: "min-h-screen bg-background p-4 text-foreground" },
        createElement(Story),
      )
    },
  ],
}

export default preview
