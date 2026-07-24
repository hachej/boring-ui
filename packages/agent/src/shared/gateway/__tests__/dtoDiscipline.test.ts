import { describe, expect, expectTypeOf, it } from 'vitest'
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
  CommandReceipt,
  CreateAgentSessionInput,
  JsonPrimitive,
  JsonSafe,
  JsonValue,
  QueueClearReceipt,
  StopReceipt,
} from '../../index'

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

describe('gateway DTO discipline', () => {
  it('keeps every transport projection structurally JSON-safe', () => {
    expectTypeOf<TransportDtoAssertions[number]>().toEqualTypeOf<true>()
    expectTypeOf<JsonSafe<unknown>>().toEqualTypeOf<JsonValue>()
    expectTypeOf<IsJsonDto<InvalidFunctionDto>>().toEqualTypeOf<false>()
    expectTypeOf<IsJsonDto<InvalidDateDto>>().toEqualTypeOf<false>()
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
