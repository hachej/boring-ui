import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import type { StorybookConfig } from "@storybook/react-vite"
import { mergeConfig } from "vite"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const config: StorybookConfig = {
  stories: [
    "../packages/workspace/stories/**/*.stories.@(ts|tsx)",
    "../packages/agent/stories/**/*.stories.@(ts|tsx)",
    "../packages/core/stories/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-viewport",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  docs: {
    autodocs: "tag",
  },
  async viteFinal(baseConfig) {
    return mergeConfig(baseConfig, {
      plugins: [tailwindcss()],
      resolve: {
        alias: [
          {
            find: /^@\/front\/lib\//,
            replacement: `${path.resolve(rootDir, "packages/workspace/src/front/lib")}/`,
          },
          {
            find: /^@\/front\//,
            replacement: `${path.resolve(rootDir, "packages/agent/src/front")}/`,
          },
          {
            find: /^@\//,
            replacement: `${path.resolve(rootDir, "packages/workspace/src")}/`,
          },
          {
            find: "@hachej/boring-workspace/ui-shadcn",
            replacement: path.resolve(rootDir, "packages/workspace/src/front/components/ui/index.ts"),
          },
          {
            find: "@hachej/boring-ui-kit",
            replacement: path.resolve(rootDir, "packages/ui/src/index.ts"),
          },
          {
            find: "@hachej/boring-workspace",
            replacement: path.resolve(rootDir, "packages/workspace/src/index.ts"),
          },
          {
            find: "@hachej/boring-agent/front/styles.css",
            replacement: path.resolve(rootDir, "packages/agent/src/front/styles/globals.css"),
          },
          {
            find: "@hachej/boring-agent/front",
            replacement: path.resolve(rootDir, "packages/agent/src/front/index.ts"),
          },
          {
            find: "@hachej/boring-agent/shared",
            replacement: path.resolve(rootDir, "packages/agent/src/shared/index.ts"),
          },
          {
            find: "@hachej/boring-agent",
            replacement: path.resolve(rootDir, "packages/agent/src/front/index.ts"),
          },
          {
            find: "@hachej/boring-core/front/top-bar-slot",
            replacement: path.resolve(rootDir, "packages/core/src/front/components/TopBarSlot.tsx"),
          },
          {
            find: "@hachej/boring-core/theme.css",
            replacement: path.resolve(rootDir, "packages/core/src/front/theme.css"),
          },
          {
            find: "@hachej/boring-core/front",
            replacement: path.resolve(rootDir, "packages/core/src/front/index.ts"),
          },
          {
            find: "@hachej/boring-core/shared",
            replacement: path.resolve(rootDir, "packages/core/src/shared/index.ts"),
          },
        ],
      },
    })
  },
}

export default config
