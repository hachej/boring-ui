import { describe, expect, it } from 'vitest'

import {
  AgentConsumptionValidationError,
  AgentMessageSchema,
  AgentRefSchema,
  AgentTaskSchema,
  ArtifactRefSchema,
  ConsumptionGuardsSchema,
  PartSchema,
  PrincipalRefSchema,
  TASK_STATES,
  TaskStateSchema,
  agentRefEquals,
  assertNoConsumptionCycle,
  assertValidTransition,
  assertWithinConsumptionDepth,
  detectConsumptionCycle,
  isValidTaskTransition,
  isWithinConsumptionDepth,
  validateAgentTask,
  validateConsumptionGuards,
  type AgentRef,
  type AgentTask,
  type ConsumptionGuards,
} from '../agent-consumption'
import { AgentConsumptionErrorCode, ERROR_CODES } from '../error-codes'

const AGENT_A: AgentRef = { agentId: 'agent-a', deploymentId: 'deploy-1' }
const AGENT_B: AgentRef = { agentId: 'agent-b', deploymentId: 'deploy-1' }
const AGENT_C: AgentRef = { agentId: 'agent-c' }

function validTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'task-1',
    contextId: 'ctx-1',
    state: 'submitted',
    messages: [
      {
        role: 'consumer',
        parts: [{ type: 'text', text: 'hello' }],
        ts: '2026-07-12T00:00:00.000Z',
      },
    ],
    artifacts: [],
    principal: { userId: 'user-1', workspaceId: 'workspace-1' },
    schemaVersion: '1',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Task lifecycle state machine — exhaustive over all 7x7 (from, to) pairs
// ---------------------------------------------------------------------------

describe('task lifecycle transitions', () => {
  const LEGAL_PAIRS = new Set([
    'submitted->working',
    'submitted->rejected',
    'submitted->canceled',
    'working->input-required',
    'working->completed',
    'working->failed',
    'working->canceled',
    'working->rejected',
    'input-required->working',
    'input-required->canceled',
  ])

  for (const from of TASK_STATES) {
    for (const to of TASK_STATES) {
      const key = `${from}->${to}`
      const legal = LEGAL_PAIRS.has(key)

      it(`${legal ? 'allows' : 'refuses'} ${key}`, () => {
        expect(isValidTaskTransition(from, to)).toBe(legal)
        if (legal) {
          expect(() => assertValidTransition(from, to)).not.toThrow()
        } else {
          expect(() => assertValidTransition(from, to)).toThrow(AgentConsumptionValidationError)
          try {
            assertValidTransition(from, to)
            throw new Error('expected assertValidTransition to throw')
          } catch (error) {
            expect(error).toBeInstanceOf(AgentConsumptionValidationError)
            expect((error as AgentConsumptionValidationError).validationCode).toBe(
              AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_INVALID_TRANSITION,
            )
          }
        }
      })
    }
  }

  it('covers exactly the documented legal-pair count (10 legal edges over 49 pairs)', () => {
    expect(LEGAL_PAIRS.size).toBe(10)
    expect(TASK_STATES.length).toBe(7)
  })

  it('permits intake-stage refusal/withdrawal before work starts (A2A v1.0)', () => {
    expect(isValidTaskTransition('submitted', 'rejected')).toBe(true)
    expect(isValidTaskTransition('submitted', 'canceled')).toBe(true)
  })

  it('permits input-required to settle into canceled (inputRequiredTimeoutMs outcome)', () => {
    expect(isValidTaskTransition('input-required', 'canceled')).toBe(true)
    expect(() => assertValidTransition('input-required', 'canceled')).not.toThrow()
  })

  it('treats every terminal state as final (no outgoing edges)', () => {
    for (const terminal of ['completed', 'failed', 'canceled', 'rejected'] as const) {
      for (const to of TASK_STATES) {
        expect(isValidTaskTransition(terminal, to)).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Cycle guard
// ---------------------------------------------------------------------------

describe('detectConsumptionCycle', () => {
  it('reports no cycle for an empty chain', () => {
    expect(detectConsumptionCycle([], AGENT_A)).toBe(false)
  })

  it('reports no cycle when next is a genuinely new agent', () => {
    expect(detectConsumptionCycle([AGENT_A, AGENT_B], AGENT_C)).toBe(false)
  })

  it('detects an immediate self-loop (A -> A)', () => {
    expect(detectConsumptionCycle([AGENT_A], AGENT_A)).toBe(true)
  })

  it('detects a same-pair oscillation (A -> B -> A)', () => {
    expect(detectConsumptionCycle([AGENT_A, AGENT_B], AGENT_A)).toBe(true)
  })

  it('detects a same-pair oscillation the other direction (A -> B, next B)', () => {
    expect(detectConsumptionCycle([AGENT_A, AGENT_B], AGENT_B)).toBe(true)
  })

  it('does not conflate two deployments of the same agentId', () => {
    const otherDeployment: AgentRef = { agentId: 'agent-a', deploymentId: 'deploy-2' }
    expect(detectConsumptionCycle([AGENT_A], otherDeployment)).toBe(false)
    expect(agentRefEquals(AGENT_A, otherDeployment)).toBe(false)
  })

  it('treats two undefined deploymentIds as equal (agentId-only identity)', () => {
    const first: AgentRef = { agentId: 'agent-x' }
    const second: AgentRef = { agentId: 'agent-x' }
    expect(agentRefEquals(first, second)).toBe(true)
    expect(detectConsumptionCycle([first], second)).toBe(true)
  })

  it('assertNoConsumptionCycle throws with the stable cycle code, and passes through otherwise', () => {
    expect(() => assertNoConsumptionCycle([AGENT_A, AGENT_B], AGENT_C)).not.toThrow()
    try {
      assertNoConsumptionCycle([AGENT_A, AGENT_B], AGENT_A)
      throw new Error('expected assertNoConsumptionCycle to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConsumptionValidationError)
      expect((error as AgentConsumptionValidationError).validationCode).toBe(
        AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_CYCLE_DETECTED,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Depth guard
// ---------------------------------------------------------------------------

describe('consumption depth guard', () => {
  const guards: ConsumptionGuards = { maxDepth: 2, inputRequiredTimeoutMs: 60_000 }

  it('allows a hop while under the max depth', () => {
    expect(isWithinConsumptionDepth([], guards)).toBe(true)
    expect(isWithinConsumptionDepth([AGENT_A], guards)).toBe(true)
    expect(() => assertWithinConsumptionDepth([AGENT_A], guards)).not.toThrow()
  })

  it('refuses a hop once the chain reaches max depth', () => {
    expect(isWithinConsumptionDepth([AGENT_A, AGENT_B], guards)).toBe(false)
    try {
      assertWithinConsumptionDepth([AGENT_A, AGENT_B], guards)
      throw new Error('expected assertWithinConsumptionDepth to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(AgentConsumptionValidationError)
      expect((error as AgentConsumptionValidationError).validationCode).toBe(
        AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_DEPTH_EXCEEDED,
      )
    }
  })

  it('refuses a chain that has already exceeded max depth', () => {
    expect(isWithinConsumptionDepth([AGENT_A, AGENT_B, AGENT_C], guards)).toBe(false)
  })

  it('validateConsumptionGuards accepts a well-formed config and rejects a malformed one', () => {
    expect(validateConsumptionGuards({ maxDepth: 3, inputRequiredTimeoutMs: 86_400_000 })).toEqual({
      valid: true,
      value: { maxDepth: 3, inputRequiredTimeoutMs: 86_400_000 },
    })

    const invalid = validateConsumptionGuards({ maxDepth: 0, inputRequiredTimeoutMs: -1 })
    expect(invalid.valid).toBe(false)
    if (!invalid.valid) {
      expect(invalid.issues.length).toBeGreaterThan(0)
      for (const issue of invalid.issues) {
        expect(issue.code).toBe(AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_SCHEMA_MISMATCH)
      }
    }
  })

  it('validateConsumptionGuards rejects extra/unknown fields (strict schema)', () => {
    expect(validateConsumptionGuards({ maxDepth: 1, inputRequiredTimeoutMs: 1, extra: true }).valid).toBe(
      false,
    )
  })
})

// ---------------------------------------------------------------------------
// Schema round-trips
// ---------------------------------------------------------------------------

describe('schema round-trips', () => {
  it('TaskStateSchema parses every declared state and rejects unknowns', () => {
    for (const state of TASK_STATES) {
      expect(TaskStateSchema.parse(state)).toBe(state)
    }
    expect(TaskStateSchema.safeParse('done').success).toBe(false)
    expect(TaskStateSchema.safeParse('SUBMITTED').success).toBe(false)
  })

  it('PrincipalRefSchema round-trips and rejects unknown fields', () => {
    const ref = { userId: 'user-1', workspaceId: 'workspace-1' }
    expect(PrincipalRefSchema.parse(ref)).toEqual(ref)
    expect(PrincipalRefSchema.safeParse({ ...ref, extra: 1 }).success).toBe(false)
    expect(PrincipalRefSchema.safeParse({ userId: 'user-1' }).success).toBe(false)
  })

  it('AgentRefSchema round-trips with and without deploymentId', () => {
    expect(AgentRefSchema.parse(AGENT_A)).toEqual(AGENT_A)
    expect(AgentRefSchema.parse(AGENT_C)).toEqual(AGENT_C)
    expect(AgentRefSchema.safeParse({}).success).toBe(false)
  })

  it('ArtifactRefSchema round-trips', () => {
    const artifact = { artifactId: 'artifact-1', mimeType: 'text/markdown', uri: 'artifact://artifact-1' }
    expect(ArtifactRefSchema.parse(artifact)).toEqual(artifact)
    expect(ArtifactRefSchema.safeParse({ ...artifact, mimeType: '' }).success).toBe(false)
  })

  it('PartSchema round-trips text, file, and data parts', () => {
    const text = { type: 'text', text: 'hi' } as const
    const file = {
      type: 'file',
      file: { artifactId: 'a1', mimeType: 'image/png', uri: 'artifact://a1' },
    } as const
    const data = { type: 'data', mimeType: 'application/json', data: { foo: 'bar' } } as const

    expect(PartSchema.parse(text)).toEqual(text)
    expect(PartSchema.parse(file)).toEqual(file)
    expect(PartSchema.parse(data)).toEqual(data)
    expect(PartSchema.safeParse({ type: 'unknown' }).success).toBe(false)
  })

  it('AgentMessageSchema round-trips', () => {
    const message = {
      role: 'agent' as const,
      parts: [{ type: 'text' as const, text: 'ack' }],
      ts: '2026-07-12T00:00:00.000Z',
    }
    expect(AgentMessageSchema.parse(message)).toEqual(message)
    expect(AgentMessageSchema.safeParse({ ...message, role: 'system' }).success).toBe(false)
  })

  it('AgentTaskSchema round-trips a full valid task', () => {
    const task = validTask()
    expect(AgentTaskSchema.parse(task)).toEqual(task)
    expect(validateAgentTask(task)).toEqual({ valid: true, value: task })
  })

  it('AgentTaskSchema round-trips with actor and artifacts populated', () => {
    const task = validTask({
      state: 'completed',
      actor: AGENT_A,
      artifacts: [{ artifactId: 'a1', mimeType: 'text/plain', uri: 'artifact://a1' }],
    })
    expect(AgentTaskSchema.parse(task)).toEqual(task)
  })

  it('requires schemaVersion and rejects any value other than the literal "1"', () => {
    const { schemaVersion: _drop, ...withoutVersion } = validTask()
    expect(AgentTaskSchema.safeParse(withoutVersion).success).toBe(false)

    const withWrongVersion = { ...validTask(), schemaVersion: '2' }
    expect(AgentTaskSchema.safeParse(withWrongVersion).success).toBe(false)

    const withNumericVersion = { ...validTask(), schemaVersion: 1 }
    expect(AgentTaskSchema.safeParse(withNumericVersion).success).toBe(false)
  })

  it('rejects unknown top-level fields (strict schema)', () => {
    expect(AgentTaskSchema.safeParse({ ...validTask(), extra: true }).success).toBe(false)
  })

  it('validateAgentTask reports the stable schema-mismatch code on invalid input', () => {
    const result = validateAgentTask({ ...validTask(), state: 'bogus-state' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0)
      for (const issue of result.issues) {
        expect(issue.code).toBe(AgentConsumptionErrorCode.enum.AGENT_CONSUMPTION_SCHEMA_MISMATCH)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Error-code registry hygiene
// ---------------------------------------------------------------------------

describe('AgentConsumptionErrorCode', () => {
  it('is canonical but stays outside the public ERROR_CODES registry', () => {
    expect(AgentConsumptionErrorCode.options).toEqual([
      'AGENT_CONSUMPTION_INVALID_TRANSITION',
      'AGENT_CONSUMPTION_CYCLE_DETECTED',
      'AGENT_CONSUMPTION_DEPTH_EXCEEDED',
      'AGENT_CONSUMPTION_SCHEMA_MISMATCH',
    ])
    for (const code of AgentConsumptionErrorCode.options) {
      expect(ERROR_CODES).not.toContain(code)
    }
  })
})
