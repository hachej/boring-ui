import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const mermaidScriptPath = fileURLToPath(import.meta.resolve('mermaid/dist/mermaid.min.js'))

const themeVariables = {
  primaryColor: '#eef2ff',
  primaryTextColor: '#172033',
  primaryBorderColor: '#5372dd',
  lineColor: '#64748b',
  secondaryColor: '#f8fafc',
  tertiaryColor: '#ffffff',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
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
    }, { diagram: source, variables: themeVariables })
  } finally {
    await browser.close()
  }
}
