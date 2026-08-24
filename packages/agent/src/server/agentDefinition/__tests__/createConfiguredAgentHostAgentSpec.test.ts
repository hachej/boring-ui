import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, test } from 'vitest'

import { createAgentAssetDigest } from '../../../shared/agent-definition'
import { ErrorCode } from '../../../shared/error-codes'
import { createConfiguredAgentHostAgentSpec, TrustedAgentCompositionError } from '../createConfiguredAgentHostAgentSpec'
import { materializeAgentDirectory } from '../materializeAgentDirectory'

const REPO_ROOT = resolve(import.meta.dirname, '../../../../../..')
const FACTORY_ROOT = resolve(REPO_ROOT, '.agents/personas')
// Deferred grow-on-demand persona material lives as test fixtures, not live
// personas. The retired triage persona remains authored material, but fleet.yaml
// now composes only orchestrator and worker.
const DEFERRED_ROOT = resolve(import.meta.dirname, 'fixtures/deferred-personas')
// [root, directory, agentTypeId, label, persona package version]. Every
// authored persona package on disk is covered, plus the deferred
// grow-on-demand fixtures — an unbooted persona still has to be a valid,
// materializable definition the moment a lane pulls it back into the roster.
const ROLES = [
  [DEFERRED_ROOT, 'concierge', 'boring-concierge', 'Boring Concierge', '2026.08.04'],
  [FACTORY_ROOT, 'triage', 'boring-triage', 'Boring Triage', '2026.08.04'],
  [DEFERRED_ROOT, 'steward', 'boring-steward', 'Boring Steward', '2026.08.04'],
  [FACTORY_ROOT, 'orchestrator', 'boring-orchestrator', 'Boring Orchestrator', '2026.08.10'],
  [FACTORY_ROOT, 'worker', 'boring-worker', 'Boring Worker', '2026.08.04'],
  [DEFERRED_ROOT, 'reviewer', 'boring-reviewer', 'Boring Reviewer', '2026.08.04'],
] as const

async function source(role = 'triage', expectedAgentTypeId = 'boring-triage') {
  return materializeAgentDirectory({
    directory: resolve(FACTORY_ROOT, role),
    expectedAgentTypeId,
    manifest: 'package.json',
  })
}

describe('Boring factory authored agents', () => {
  test.each(ROLES)('materializes identity-only persona definition (case %#)', async (root, role, agentTypeId, label, version) => {
    const manifestPath = resolve(root, role, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const boringAgent = (manifest.boring as Record<string, unknown>).agent as Record<string, unknown>

    expect(Object.keys(boringAgent).sort()).toEqual([
      'definitionId',
      'description',
      'instructionsRef',
      'label',
      'version',
    ])
    await expect(
      materializeAgentDirectory({
        directory: resolve(root, role),
        expectedAgentTypeId: agentTypeId,
        manifest: 'package.json',
      }),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      agentTypeId,
      label,
      version,
    })
  })
})

describe('createConfiguredAgentHostAgentSpec', () => {
  test('adds only trusted instruction, plugin, and model policy', async () => {
    const authored = await source()
    const skillContent = '---\nname: triage\n---\n\nFollow the canonical triage process.\n'
    const digest = await createAgentAssetDigest(skillContent)

    const spec = await createConfiguredAgentHostAgentSpec({
      source: authored,
      policy: {
        instructionAppendices: [{ name: 'triage', content: skillContent, digest }],
        plugins: [{ name: 'boring-factory', config: { mode: 'triage' } }],
        preferredModel: 'test-provider:test-model',
      },
    })

    expect(spec).toMatchObject({
      agentTypeId: 'boring-triage',
      definition: { label: 'Boring Triage', version: '2026.08.04' },
      plugins: [{ name: 'boring-factory', config: { mode: 'triage' } }],
      model: { preferred: 'test-provider:test-model' },
    })
    expect(spec.definition.instructions).toContain(authored.instructions)
    expect(spec.definition.instructions).toContain(`name=triage digest=${digest}`)
    expect(spec.definition.instructions).toContain(skillContent)
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.definition)).toBe(true)
    expect(Object.isFrozen(spec.plugins)).toBe(true)
    expect(Object.isFrozen(spec.plugins?.[0]?.config)).toBe(true)
  })

  test('rejects mismatched and duplicate trusted appendices', async () => {
    const authored = await source()
    const content = 'canonical content'
    const digest = await createAgentAssetDigest('different content')

    await expect(createConfiguredAgentHostAgentSpec({
      source: authored,
      policy: { instructionAppendices: [{ name: 'triage', content, digest }] },
    })).rejects.toMatchObject({
      name: 'TrustedAgentCompositionError',
      code: ErrorCode.enum.CONFIG_INVALID,
      field: 'policy.instructionAppendices[0].digest',
    })

    const validDigest = await createAgentAssetDigest(content)
    await expect(createConfiguredAgentHostAgentSpec({
      source: authored,
      policy: {
        instructionAppendices: [
          { name: 'triage', content, digest: validDigest },
          { name: 'triage', content, digest: validDigest },
        ],
      },
    })).rejects.toBeInstanceOf(TrustedAgentCompositionError)
  })

  test('requires a trusted fallback when authored label is absent', async () => {
    const authored = await source()
    const { label: _label, ...withoutLabel } = authored

    await expect(createConfiguredAgentHostAgentSpec({ source: withoutLabel })).rejects.toMatchObject({
      field: 'policy.fallbackLabel',
    })
    await expect(createConfiguredAgentHostAgentSpec({
      source: withoutLabel,
      policy: { fallbackLabel: 'Trusted fallback' },
    })).resolves.toMatchObject({ definition: { label: 'Trusted fallback' } })
  })
})
