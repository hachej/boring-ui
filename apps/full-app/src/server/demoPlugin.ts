import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoreWorkspaceAgentServerPlugin } from '@hachej/boring-core/app/server'

// demo-sdk lives at the app root (apps/full-app/demo-sdk). This file runs from
// either src/server (dev/tsx) or dist/server (build) — both are two levels under
// the app root, so ../../demo-sdk resolves correctly in both.
const here = dirname(fileURLToPath(import.meta.url))
const demoSdkRoot = join(here, '..', '..', 'demo-sdk')

/**
 * Demo plugin for the full-app: provisions a dummy Python CLI (`democli`) into
 * each workspace and tells the agent how to use the Python runtime. Purely for
 * demo/testing the custom-SDK provisioning path (mirrors how boring-macro ships
 * its real `bm` SDK).
 */
export const demoCliPlugin: CoreWorkspaceAgentServerPlugin = {
  id: 'demo-cli',
  systemPrompt: [
    '## Python runtime',
    'This workspace has Python 3 and the Astral `uv` package manager available on PATH.',
    '- Run scripts with `python3`.',
    '- Install/manage packages with **`uv pip install <pkg>`** (preferred — fast; installs into the workspace venv at `.boring-agent/venv`). `uv` is the canonical package manager here; do not assume only `pip`.',
    '- Create venvs with `uv venv` if needed.',
    '',
    '## Demo CLI',
    'A demo command `democli` is preinstalled in this workspace. Try `democli`, `democli info`, or `democli echo hello`.',
  ].join('\n'),
  provisioning: {
    python: [
      {
        id: 'boring-demo-sdk',
        packageName: 'boring-demo-sdk',
        projectFile: join(demoSdkRoot, 'pyproject.toml'),
        expectedBins: ['democli'],
      },
    ],
  },
}
