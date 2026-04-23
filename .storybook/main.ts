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
            find: /^@\/front-shadcn\//,
            replacement: `${path.resolve(rootDir, "packages/agent/src/front-shadcn")}/`,
          },
          {
            find: /^@\//,
            replacement: `${path.resolve(rootDir, "packages/workspace/src")}/`,
          },
          {
            find: "@boring/workspace",
            replacement: path.resolve(rootDir, "packages/workspace/src/index.ts"),
          },
          {
            find: "@boring/agent",
            replacement: path.resolve(rootDir, "packages/agent/src/index.ts"),
          },
        ],
      },
    })
  },
}

export default config
