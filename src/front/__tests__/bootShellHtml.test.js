import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = path.resolve(__dirname, '../../..')
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8')

describe('boot shell html', () => {
  it('gives the root shell full viewport sizing before React mounts', () => {
    expect(indexHtml).toContain('#root { min-height: 100vh; width: 100%; display: flex; }')
    expect(indexHtml).toContain('<body style="margin:0;min-height:100vh;min-width:100vw;">')
    expect(indexHtml).toContain('<div id="root" style="min-height:100vh;width:100%;display:flex;">')
  })

  it('keeps the pre-react loader centered with inline sizing', () => {
    expect(indexHtml).toContain('id="app-boot-loader" style="display:flex;align-items:center;justify-content:center;min-height:100vh;width:100%;')
  })
})
