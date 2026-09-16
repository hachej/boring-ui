import path from 'node:path'

import type { AgentTool, Workspace } from '@hachej/boring-agent/shared'

import { INSTRUCTIONS_RELATIVE_PATH } from './instructionsFile.js'

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return {
    content: [{ type: 'text', text: body }],
    ...(isError ? { isError: true } : {}),
  }
}

/** Named standing-instruction tools backed only by the runtime Workspace. */
export function createInstructionsTools(options: { readonly workspace: Workspace; readonly invalidatePrompt: () => void }): AgentTool[] {
  const read: AgentTool = {
    name: 'read_my_instructions',
    description: 'Read your current standing instructions for this app (how the user wants you to behave from now on).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      try {
        return text(await options.workspace.readFile(INSTRUCTIONS_RELATIVE_PATH))
      } catch {
        return text('(no standing instructions yet)')
      }
    },
  }

  const update: AgentTool = {
    name: 'update_my_instructions',
    description:
      'Replace your standing instructions for this app with the complete new text. Call this whenever the user asks you to behave differently from now on (language, tone, names, rules). Keep everything that still applies and change only what they asked. The new instructions apply from the next message.',
    parameters: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'The complete new standing instructions, in Markdown. Not a diff.',
        },
      },
      required: ['instructions'],
      additionalProperties: false,
    },
    async execute(params) {
      const body = typeof params.instructions === 'string' ? params.instructions.trim() : ''
      if (!body) return text('Instructions cannot be empty.', true)
      await options.workspace.mkdir(path.dirname(INSTRUCTIONS_RELATIVE_PATH), {
        recursive: true,
      })
      await options.workspace.writeFile(INSTRUCTIONS_RELATIVE_PATH, `${body}\n`)
      options.invalidatePrompt()
      return text('Saved. These instructions apply from the next message.')
    },
  }

  return [read, update]
}
