import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')

describe('Phase 1 Low-Risk Primitive Migration Contract', () => {
  it('keeps Tooltip wrapper wired to shared tooltip primitives', () => {
    const source = readRepoFile('src/front/components/Tooltip.jsx')
    expect(source).toContain("from './ui/tooltip'")
    expect(source).toContain('<TooltipProvider')
    expect(source).toContain('<TooltipTrigger')
    expect(source).toContain('<TooltipContent')
  })

  it('keeps UserMenu avatar + divider surfaces on shared primitives', () => {
    const source = readRepoFile('src/front/components/UserMenu.jsx')
    expect(source).toContain("from './ui/avatar'")
    expect(source).toContain("from './ui/separator'")
    expect(source).toContain('<Avatar')
    expect(source).toContain('<Separator')
  })

  it('keeps SyncStatusFooter menu separator/input surfaces on shared primitives', () => {
    const source = readRepoFile('src/front/components/SyncStatusFooter.jsx')
    expect(source).toContain("from './ui/input'")
    expect(source).toContain("from './ui/separator'")
    expect(source).toContain('<Input')
    expect(source).toContain('<Separator')
  })

  it('keeps auth mode switch on shared tabs primitives', () => {
    const source = readRepoFile('src/front/pages/AuthPage.jsx')
    expect(source).toContain("from '../components/ui/tabs'")
    expect(source).toContain('<Tabs')
    expect(source).toContain('<TabsList')
    expect(source).toContain('<TabsTrigger')
  })

  it('documents intentional custom low-risk surfaces', () => {
    const runbook = readRepoFile('docs/runbooks/PHASE1_LOW_RISK_PRIMITIVE_MIGRATION.md')
    expect(runbook).toContain('Intentionally Custom Low-Risk Surfaces')
    expect(runbook).toContain('SyncStatusFooter')
    expect(runbook).toContain('FileTree')
    expect(runbook).toContain('Git branch submenu')
  })
})
