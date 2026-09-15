import type { AgentTool } from '@hachej/boring-agent/shared'

import { resolveStageUrl } from '../shared/allowedOrigins.js'
import type { StageBus } from './stageBus.js'

export interface StageToolsOptions {
  readonly bus: StageBus
  /** Origin patterns that may be framed. See ../shared/allowedOrigins.ts. */
  readonly allowedOrigins: readonly string[]
}

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) }
}

/**
 * The two tools that let the agent drive the right-hand screen. Deliberately
 * tiny: everything the agent can do to the stage is "put this one page over the
 * app" and "take it away".
 */
export function createStageTools(options: StageToolsOptions): AgentTool[] {
  const showOnScreen: AgentTool = {
    name: 'show_on_screen',
    description:
      'Show a page on the user\'s screen, on top of their app. Use it for a mockup, a preview or a page you want the user to look at. Only one thing can be shown at a time; calling this again replaces it. Call back_to_app when the user is done looking.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http(s) URL to display. Must be a local address unless the host allows more.',
        },
        title: {
          type: 'string',
          description: 'Short human title shown above the page, e.g. "New client page".',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    async execute(params) {
      const resolution = resolveStageUrl(typeof params.url === 'string' ? params.url : '', options.allowedOrigins)
      if (!resolution.ok) return text(`Could not show that on screen: ${resolution.message}`, true)

      const rawTitle = typeof params.title === 'string' ? params.title.trim() : ''
      const title = rawTitle || 'Preview'
      options.bus.emit({ type: 'stage.show', url: resolution.url, title })
      return text(`Showing "${title}" on the user's screen.`)
    },
  }

  const backToApp: AgentTool = {
    name: 'back_to_app',
    description: "Close whatever is being shown on top of the user's app and put them back on their app.",
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      options.bus.emit({ type: 'stage.clear' })
      return text('The user is back on their app.')
    },
  }

  return [showOnScreen, backToApp]
}
