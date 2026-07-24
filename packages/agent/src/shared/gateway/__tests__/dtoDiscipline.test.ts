import { describe, expect, expectTypeOf, it } from 'vitest'
import { AgentGatewayErrorCode } from '../../index'
import type {
  AgentFollowUpCommand,
  AgentGatewayErrorDTO,
  AgentPromptCommand,
  AgentSendReceipt,
  AgentSessionEvent,
  AgentSessionPage,
  AgentSessionRef,
  AgentSessionStateSnapshot,
  AgentSummary,
  AuthorizedAgentScope,
  CreateAgentSessionInput,
  JsonPrimitive,
  JsonSafe,
  JsonValue,
  PiChatEvent,
  PiChatSnapshot,
} from '../../index'
import type {
  CommandReceipt,
  QueueClearReceipt,
  StopReceipt,
} from '../types'

type IsJsonDto<T> = unknown extends T
  ? false
  : IsJsonDtoValue<Exclude<T, undefined>>

type IsJsonDtoValue<T> = [T] extends [JsonPrimitive]
  ? true
  : T extends (...args: readonly never[]) => unknown
    ? false
    : T extends Date
      ? false
      : T extends readonly (infer U)[]
        ? IsJsonDto<U>
        : T extends object
          ? Exclude<keyof T, string> extends never
            ? false extends { [K in keyof T]-?: IsJsonDto<T[K]> }[keyof T]
              ? false
              : true
            : false
          : false

type AssertJsonDto<T extends true> = T

type TransportDtoAssertions = [
  AssertJsonDto<IsJsonDto<AgentSessionRef>>,
  AssertJsonDto<IsJsonDto<AgentSummary>>,
  AssertJsonDto<IsJsonDto<AgentSessionPage>>,
  AssertJsonDto<IsJsonDto<AgentPromptCommand>>,
  AssertJsonDto<IsJsonDto<AgentFollowUpCommand>>,
  AssertJsonDto<IsJsonDto<CommandReceipt>>,
  AssertJsonDto<IsJsonDto<AgentSendReceipt>>,
  AssertJsonDto<IsJsonDto<QueueClearReceipt>>,
  AssertJsonDto<IsJsonDto<StopReceipt>>,
  AssertJsonDto<IsJsonDto<Omit<AgentSessionStateSnapshot, 'state'>>>,
  AssertJsonDto<IsJsonDto<Omit<AgentSessionEvent, 'event'>>>,
  AssertJsonDto<IsJsonDto<Omit<AgentGatewayErrorDTO, 'details'>>>,
]

interface InvalidFunctionDto {
  readonly callback: () => void
}
interface InvalidDateDto {
  readonly createdAt: Date
}

function requireAuthorizedScope(_scope: AuthorizedAgentScope): void {}

function assertReadonlyReceipts(
  command: CommandReceipt,
  queueClear: QueueClearReceipt,
  stop: StopReceipt,
): void {
  // @ts-expect-error Gateway receipts are immutable DTOs.
  command.cursor = 2
  // @ts-expect-error Gateway receipts are immutable DTOs.
  queueClear.cleared = 2
  // @ts-expect-error Cleared queue snapshots are readonly.
  stop.clearedQueue.push({ id: 'x', kind: 'followup', displayText: 'x' })
}

void assertReadonlyReceipts

describe('gateway DTO discipline', () => {
  it('keeps every transport projection structurally JSON-safe', () => {
    expectTypeOf<TransportDtoAssertions[number]>().toEqualTypeOf<true>()
    expectTypeOf<JsonSafe<unknown>>().toEqualTypeOf<JsonValue>()
    expectTypeOf<AgentSessionStateSnapshot['state']>().toEqualTypeOf<JsonSafe<PiChatSnapshot>>()
    expectTypeOf<AgentSessionEvent['event']>().toEqualTypeOf<JsonSafe<PiChatEvent>>()
    expectTypeOf<AgentGatewayErrorDTO['details']>().toEqualTypeOf<JsonValue | undefined>()
    expectTypeOf<IsJsonDto<InvalidFunctionDto>>().toEqualTypeOf<false>()
    expectTypeOf<IsJsonDto<InvalidDateDto>>().toEqualTypeOf<false>()
  })

  it('serializes complete snapshot, event, and error DTOs at the existing JSON boundary', () => {
    const ref = { agentTypeId: 'alpha', sessionId: 'session-1' }
    const snapshot = {
      ref,
      seq: 1,
      summary: {
        ref,
        title: 'Session',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
      },
      state: {
        protocolVersion: 1,
        sessionId: ref.sessionId,
        seq: 1,
        status: 'idle',
        messages: [],
        queue: { followUps: [] },
        followUpMode: 'one-at-a-time',
      },
    } satisfies AgentSessionStateSnapshot
    const event = {
      ref,
      seq: 1,
      event: { type: 'usage', seq: 1, usage: { inputTokens: 2 } },
    } satisfies AgentSessionEvent
    const error = {
      code: AgentGatewayErrorCode.AGENT_SESSION_REPLAY_GAP,
      message: 'rehydrate',
      details: { latestSeq: 1 },
    } satisfies AgentGatewayErrorDTO

    expect(() => JSON.stringify({ snapshot, event, error })).not.toThrow()
  })

  it('does not permit structural construction of an AuthorizedAgentScope', () => {
    const plain = { workspaceScopeId: 'workspace-a', authSubjectId: 'subject-a' }
    // @ts-expect-error The issuer-owned symbol brand is absent.
    requireAuthorizedScope(plain)

    const issued = plain as AuthorizedAgentScope
    // A spread retains the compile-time brand; provenance checking by the
    // issuer is what rejects the new object at runtime (covered by conformance).
    const spread = { ...issued }
    requireAuthorizedScope(spread)

    const input: CreateAgentSessionInput = {
      scope: issued,
      agentTypeId: 'alpha',
      requestId: 'request-1',
    }
    expect(input.scope).toBe(issued)
    expect({ ...input }.scope).toBe(issued)

    const roundTrip: unknown = JSON.parse(JSON.stringify(issued))
    // @ts-expect-error JSON data is not an issuer-owned capability.
    requireAuthorizedScope(roundTrip)

    expect(JSON.parse(JSON.stringify(issued))).toEqual(plain)
    expectTypeOf<IsJsonDto<AuthorizedAgentScope>>().toEqualTypeOf<false>()
  })
})
