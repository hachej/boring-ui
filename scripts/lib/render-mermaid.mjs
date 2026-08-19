import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const mermaidScriptPath = fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js'))

export const mermaidThemeVariables = {
  background: '#11151c',
  primaryColor: '#202838',
  primaryTextColor: '#eef2ff',
  primaryBorderColor: '#6f8cff',
  lineColor: '#a7b4d8',
  secondaryColor: '#171d28',
  tertiaryColor: '#252d3c',
  textColor: '#eef2ff',
  actorBkg: '#202838',
  actorBorder: '#6f8cff',
  actorTextColor: '#eef2ff',
  actorLineColor: '#7d94ff',
  signalColor: '#c5d0ec',
  signalTextColor: '#eef2ff',
  labelBoxBkgColor: '#171d28',
  labelBoxBorderColor: '#46526b',
  labelTextColor: '#eef2ff',
  loopTextColor: '#eef2ff',
  noteBkgColor: '#332d1f',
  noteTextColor: '#fff1bd',
  noteBorderColor: '#9b8038',
  fontFamily: 'Aptos, Segoe UI, sans-serif',
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function namespaceMermaidSvgIds(svg, namespace) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  const replacements = new Map(ids.map((id) => [id, id === namespace || id.startsWith(`${namespace}-`) ? id : `${namespace}-${id}`]))
  let output = svg
  for (const [id, namespaced] of [...replacements].sort((a, b) => b[0].length - a[0].length)) {
    const escaped = escapeRegExp(id)
    output = output
      .replace(new RegExp(`(\\sid=")${escaped}(")`, 'g'), `$1${namespaced}$2`)
      .replace(new RegExp(`#${escaped}(?![A-Za-z0-9_.:-])`, 'g'), `#${namespaced}`)
  }
  return output
}

export async function renderMermaidSvg(source, renderId = 'pr-context-diagram') {
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    throw new Error('Mermaid pre-render requires Playwright Chromium. From the lane worktree run: pnpm exec playwright install chromium', { cause: error })
  }
  try {
    const page = await browser.newPage()
    await page.setContent('<main id="diagram"></main>')
    await page.addScriptTag({ path: mermaidScriptPath })
    const svg = await page.evaluate(async ({ diagram, variables, id }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: variables,
      })
      const { svg } = await mermaid.render(id, diagram)
      return svg
    }, { diagram: source, variables: mermaidThemeVariables, id: renderId })
    return namespaceMermaidSvgIds(svg, renderId)
  } finally {
    await browser.close()
  }
}
