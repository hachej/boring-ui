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

export async function renderMermaidSvg(source) {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<main id="diagram"></main>')
    await page.addScriptTag({ path: mermaidScriptPath })
    return await page.evaluate(async ({ diagram, variables }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: variables,
      })
      const { svg } = await mermaid.render('pr-context-diagram', diagram)
      return svg
    }, { diagram: source, variables: mermaidThemeVariables })
  } finally {
    await browser.close()
  }
}
