import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { parse as parseYaml } from 'yaml'
import { beforeAll, describe, expect, test } from 'vitest'

import {
  parseModelTierCandidates,
  resolveSeatModel,
} from '../loadConfiguredAgentFleet'

const FLEET_CONFIG_PATH = resolve(import.meta.dirname, '../../../../../../.agents/factory/fleet.yaml')

// A configured model id that drifts from pi's real catalog is invisible at
// typecheck time and only fails live, at session start, when
// createConfiguredAgentHostAgentSpec's preferredModel flips
// strictModelResolution — exactly what happened with T1's 'claude-fable'
// (catalog has 'claude-fable-5'). This test catches that class of drift in
// CI by loading fleet.yaml and resolving every candidate against a real
// ModelRegistry.
describe('fleet model tier candidates', () => {
  const registry = ModelRegistry.create(AuthStorage.create())
  let candidates: ReturnType<typeof parseModelTierCandidates>

  beforeAll(async () => {
    candidates = parseModelTierCandidates(
      parseYaml(await readFile(FLEET_CONFIG_PATH, 'utf8')),
      FLEET_CONFIG_PATH,
    )
  })

  test('every configured candidate exists in ModelRegistry', () => {
    for (const [tier, tierCandidates] of Object.entries(candidates)) {
      for (const candidate of tierCandidates) {
        const model = registry.find(candidate.provider, candidate.id)
        expect(model, `${candidate.provider}:${candidate.id} (tier ${tier}) is not a known pi model — ` +
          'update .agents/factory/fleet.yaml to a real catalog id').toBeDefined()
      }
    }
  })

  test('prefers Anthropic when both provider keys are present', () => {
    expect(resolveSeatModel('T1', {
      ANTHROPIC_API_KEY: 'anthropic-key',
      GEMINI_API_KEY: 'gemini-key',
    }, candidates)).toBe('anthropic:claude-fable-5')
  })

  test('falls back to Gemini when only GEMINI_API_KEY is present', () => {
    expect(resolveSeatModel('T1', { GEMINI_API_KEY: 'gemini-key' }, candidates))
      .toBe('google:gemini-3.1-pro-preview')
  })

  test('returns undefined when no candidate key is present', () => {
    expect(resolveSeatModel('T1', {}, candidates)).toBeUndefined()
  })
})
