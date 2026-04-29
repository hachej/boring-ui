/**
 * Pure matcher logic for the eval framework. No LLM, no fetch, no
 * Fastify — exercised in unit tests against fixed ToolCall[] inputs.
 *
 * The matcher implements three modes:
 * 1. someCallMatches (default `expect`) — every ExpectedCall must match
 *    at least one actual ToolCall, any order. Captures parallel /
 *    sequential tool calling without assuming an order the LLM didn't
 *    actually commit to.
 * 2. firstCallMatches (`expectFirst`) — actual[0] must match the
 *    ExpectedCall. Use only when ordering is part of the contract.
 * 3. noToolCall (`expectNoToolCall`) — actual must be empty. The LLM
 *    answered in plain text without tooling.
 *
 * Param matching is partial by default: every key in expect.params must
 * appear in actual.params with a matching value, but extra keys in
 * actual are ignored. Set `strict: true` to require exact equality (no
 * extra keys allowed).
 */
import {
  EvalAny,
  isEvalRegex,
  type EvalAnyType,
  type EvalRegexMatcher,
  type ExpectedCall,
  type ToolCall,
} from "./types"

export interface MatchOutcome {
  ok: boolean
  /** Index into `actual[]` that satisfied the expected call. -1 on failure. */
  matchedIndex: number
  /** Diagnostic when ok is false. */
  reason?: string
}

/**
 * Does ONE actual call satisfy ONE expected call? Used as the inner
 * predicate by all three modes.
 */
export function callSatisfies(
  expected: ExpectedCall,
  actual: ToolCall,
): MatchOutcome {
  if (expected.tool !== actual.tool) {
    return {
      ok: false,
      matchedIndex: -1,
      reason: `tool mismatch: expected "${expected.tool}", got "${actual.tool}"`,
    }
  }
  if (!expected.params) {
    return { ok: true, matchedIndex: 0 }
  }
  const paramsCheck = matchParams(expected.params, actual.params, expected.strict ?? false)
  if (!paramsCheck.ok) {
    return { ok: false, matchedIndex: -1, reason: paramsCheck.reason }
  }
  return { ok: true, matchedIndex: 0 }
}

/**
 * "Does at least one of `actual` satisfy each entry in `expected`?"
 * Returns the index of the first match for each expected entry.
 */
export function someCallMatches(
  expected: ExpectedCall | ExpectedCall[],
  actual: ToolCall[],
): MatchOutcome {
  const expectedList = Array.isArray(expected) ? expected : [expected]

  for (const exp of expectedList) {
    let matched = false
    let lastReason: string | undefined
    for (const cand of actual) {
      const out = callSatisfies(exp, cand)
      if (out.ok) {
        matched = true
        break
      }
      lastReason = out.reason
    }
    if (!matched) {
      return {
        ok: false,
        matchedIndex: -1,
        reason: lastReason
          ? `no actual call matched expected ${formatExpected(exp)} — closest mismatch: ${lastReason}`
          : `no actual call matched expected ${formatExpected(exp)} (actual was empty)`,
      }
    }
  }
  return { ok: true, matchedIndex: 0 }
}

export function firstCallMatches(
  expected: ExpectedCall,
  actual: ToolCall[],
): MatchOutcome {
  if (actual.length === 0) {
    return {
      ok: false,
      matchedIndex: -1,
      reason: `expectFirst: no tool calls captured (LLM answered in plain text)`,
    }
  }
  return callSatisfies(expected, actual[0]!)
}

export function noToolCallMatches(actual: ToolCall[]): MatchOutcome {
  if (actual.length === 0) {
    return { ok: true, matchedIndex: -1 }
  }
  return {
    ok: false,
    matchedIndex: -1,
    reason: `expectNoToolCall: ${actual.length} tool call(s) captured: ${actual
      .map((c) => c.tool)
      .join(", ")}`,
  }
}

// ----- internal: param matching with EvalAny / EvalRegex / partial vs strict ----- //

interface ParamMatchOutcome {
  ok: boolean
  reason?: string
}

function matchParams(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  strict: boolean,
  pathPrefix = "",
): ParamMatchOutcome {
  for (const key of Object.keys(expected)) {
    const expVal = expected[key]
    const actVal = actual[key]
    const path = pathPrefix ? `${pathPrefix}.${key}` : key

    // Wildcard: must be present (any non-undefined value).
    if (expVal === EvalAny || isEvalAnySymbol(expVal)) {
      if (actVal === undefined) {
        return { ok: false, reason: `${path}: missing (expected !EvalAny)` }
      }
      continue
    }

    // Wildcard: regex match against string.
    if (isEvalRegex(expVal)) {
      if (typeof actVal !== "string") {
        return {
          ok: false,
          reason: `${path}: expected string for !EvalRegex, got ${typeof actVal}`,
        }
      }
      if (!(expVal as EvalRegexMatcher).__evalRegex.test(actVal)) {
        return {
          ok: false,
          reason: `${path}: ${JSON.stringify(actVal)} does not match /${(expVal as EvalRegexMatcher).__evalRegex.source}/`,
        }
      }
      continue
    }

    // Nested object: recurse with same strict flag.
    if (
      typeof expVal === "object" &&
      expVal !== null &&
      !Array.isArray(expVal)
    ) {
      if (
        typeof actVal !== "object" ||
        actVal === null ||
        Array.isArray(actVal)
      ) {
        return {
          ok: false,
          reason: `${path}: expected object, got ${describe(actVal)}`,
        }
      }
      const nested = matchParams(
        expVal as Record<string, unknown>,
        actVal as Record<string, unknown>,
        strict,
        path,
      )
      if (!nested.ok) return nested
      continue
    }

    // Array: structural-equality element-wise.
    if (Array.isArray(expVal)) {
      if (!Array.isArray(actVal)) {
        return {
          ok: false,
          reason: `${path}: expected array, got ${describe(actVal)}`,
        }
      }
      if (expVal.length !== actVal.length) {
        return {
          ok: false,
          reason: `${path}: array length mismatch (expected ${expVal.length}, got ${actVal.length})`,
        }
      }
      for (let i = 0; i < expVal.length; i++) {
        const elemMatch = matchParams(
          { item: expVal[i] } as Record<string, unknown>,
          { item: actVal[i] } as Record<string, unknown>,
          strict,
          `${path}[${i}]`,
        )
        if (!elemMatch.ok) return elemMatch
      }
      continue
    }

    // Primitive: strict equality.
    if (expVal !== actVal) {
      return {
        ok: false,
        reason: `${path}: expected ${JSON.stringify(expVal)}, got ${JSON.stringify(actVal)}`,
      }
    }
  }

  // strict mode: actual must have NO extra keys
  if (strict) {
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) {
        const path = pathPrefix ? `${pathPrefix}.${key}` : key
        return {
          ok: false,
          reason: `${path}: unexpected key (strict mode)`,
        }
      }
    }
  }

  return { ok: true }
}

function isEvalAnySymbol(value: unknown): value is EvalAnyType {
  return value === EvalAny
}

function describe(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (value === undefined) return "undefined"
  return typeof value
}

function formatExpected(exp: ExpectedCall): string {
  if (!exp.params) return `{tool: ${exp.tool}}`
  return `{tool: ${exp.tool}, params: ${safeStringify(exp.params)}}`
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v === EvalAny) return "<EvalAny>"
      if (isEvalRegex(v)) return `<EvalRegex /${v.__evalRegex.source}/>`
      return v
    })
  } catch {
    return "<unserializable>"
  }
}
