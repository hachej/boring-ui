import type { AgentTool } from '@hachej/boring-agent/shared'

import { resolveStageUrl } from '../shared/allowedOrigins.js'
import type { AppLifecycle } from './appLifecycle.js'
import type { StageBus } from './stageBus.js'

export interface StageToolsOptions {
  readonly bus: StageBus
  readonly allowedOrigins: readonly string[]
  readonly appBaseUrl?: string
  readonly lifecycle?: AppLifecycle
}

function text(body: string, isError = false): Awaited<ReturnType<AgentTool['execute']>> {
  return { content: [{ type: 'text', text: body }], ...(isError ? { isError: true } : {}) }
}

function showApp(options: StageToolsOptions, title?: string): Awaited<ReturnType<AgentTool['execute']>> {
  if (!options.appBaseUrl) return text('The app URL is not available.', true)
  options.bus.emit({ type: 'stage.show', what: 'app', url: options.appBaseUrl, title: title?.trim() || 'Your app' })
  return text('Showing the app on the user\'s screen.')
}

export function createStageTools(options: StageToolsOptions): AgentTool[] {
  const showOnScreen: AgentTool = {
    name: 'show_on_screen',
    description:
      'Show either the user\'s app or one preview/sketch page. On a fresh app, do not show the empty template. Show the app after the first real build, or when the user asks to see it. Showing again replaces the current screen.',
    parameters: {
      type: 'object',
      properties: {
        what: {
          type: 'string',
          enum: ['app', 'page'],
          description: 'Use "app" for the live app and "page" for a preview or sketch URL.',
        },
        url: {
          type: 'string',
          description: 'Absolute http(s) URL. Required only when what is "page".',
        },
        title: {
          type: 'string',
          description: 'Short human title, e.g. "Supplier sketch".',
        },
      },
      required: ['what'],
      additionalProperties: false,
    },
    async execute(params) {
      if (params.what === 'app') return showApp(options, typeof params.title === 'string' ? params.title : undefined)
      if (params.what !== 'page') return text('Choose either app or page.', true)
      const resolution = resolveStageUrl(typeof params.url === 'string' ? params.url : '', options.allowedOrigins)
      if (!resolution.ok) return text(`Could not show that on screen: ${resolution.message}`, true)
      const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim() : 'Preview'
      options.bus.emit({ type: 'stage.show', what: 'page', url: resolution.url, title, label: 'preview' })
      return text(`Showing "${title}" on the user's screen.`)
    },
  }

  const backToApp: AgentTool = {
    name: 'back_to_app',
    description: 'Replace the current preview with the live app.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      await options.lifecycle?.backToApp()
      return showApp(options)
    },
  }

  const clearScreen: AgentTool = {
    name: 'clear_screen',
    description: 'Hide the screen and return to full-width chat.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      options.bus.emit({ type: 'stage.clear' })
      return text('The screen is clear and chat is full width.')
    },
  }

  return [showOnScreen, backToApp, clearScreen]
}
