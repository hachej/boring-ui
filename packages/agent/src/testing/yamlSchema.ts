/**
 * Custom YAML tags for the eval matcher DSL.
 *
 * Authors write `id: !EvalAny` and `component: !EvalRegex "^chart:"` in
 * fixture YAML; this module configures the `yaml` package to resolve
 * those tags to the JS-side matchers (`EvalAny` symbol / `EvalRegex`
 * matcher object) that matcher.ts consumes.
 *
 * Without these tags the YAML parser would treat `!EvalAny` as either a
 * parse error or (with a permissive parser) the string "!EvalAny".
 */
import { parse, Schema } from "yaml"
import { EvalAny, EvalRegex } from "./types"
import type { SuiteFixture } from "./types"

/**
 * `yaml` package custom tag definitions. Pass to `parse(text, { schema })`.
 * Both tags are non-string scalar tags (no value vs string value).
 */
const evalSchema = new Schema({
  customTags: [
    {
      tag: "!EvalAny",
      // No value — `!EvalAny` alone resolves to the symbol.
      identify: (value: unknown) => value === EvalAny,
      resolve: () => EvalAny,
    },
    {
      tag: "!EvalRegex",
      // Scalar value — `!EvalRegex "^chart:"` resolves to a matcher object.
      identify: (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        "__evalRegex" in (value as Record<string, unknown>),
      resolve: (str: string) => EvalRegex(str),
    },
  ],
})

/**
 * Parse a YAML fixture file (text contents) into a `SuiteFixture`.
 *
 * Delegates to the `yaml` package with the custom-tag schema so the
 * matcher wildcards (`!EvalAny`, `!EvalRegex`) resolve into runtime
 * values matcher.ts can consume.
 *
 * Throws on invalid YAML syntax. Returns whatever shape parses — minimal
 * runtime validation here (caller asserts with the SuiteFixture type).
 */
export function parseFixtureYaml(text: string): SuiteFixture {
  const parsed = parse(text, { schema: evalSchema as unknown as never }) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Eval fixture must be a YAML object with a "prompts" key. Got: ${describe(parsed)}`,
    )
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.prompts)) {
    throw new Error(`Eval fixture missing "prompts" array.`)
  }
  return obj as unknown as SuiteFixture
}

function describe(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return "array"
  return typeof value
}
