import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { describe, expect, test } from 'vitest'

import { MODEL_TIER_CANDIDATES } from '../loadConfiguredAgentFleet'

// B1 (gh-1106 slice 3 fix round 1): MODEL_TIER_CANDIDATES is a hand-synced
// map against MODEL-CARD.md's tier table (deliberately not parsed from the
// markdown). A model id that drifts from pi's real catalog is invisible at
// typecheck time and only fails live, at session start, when
// createConfiguredAgentHostAgentSpec's preferredModel flips
// strictModelResolution — exactly what happened with T1's 'claude-fable'
// (catalog has 'claude-fable-5'). This test catches that class of drift in
// CI by resolving every candidate against a real ModelRegistry.
describe('MODEL_TIER_CANDIDATES resolves against the real pi model catalog', () => {
  const registry = ModelRegistry.create(AuthStorage.create())

  for (const [tier, candidates] of Object.entries(MODEL_TIER_CANDIDATES)) {
    for (const candidate of candidates) {
      test(`${tier}: ${candidate.provider}:${candidate.id} exists in ModelRegistry`, () => {
        const model = registry.find(candidate.provider, candidate.id)
        expect(model, `${candidate.provider}:${candidate.id} (tier ${tier}) is not a known pi model — ` +
          'update MODEL_TIER_CANDIDATES in loadConfiguredAgentFleet.ts to a real catalog id').toBeDefined()
      })
    }
  }
})
