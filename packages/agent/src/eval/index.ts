/**
 * @boring/agent/eval — eval framework for LLM tool-selection behavior.
 *
 * See packages/agent/docs/plans/AGENT_EVAL_FRAMEWORK.md for the design.
 *
 * Single-prompt usage (in a vitest test):
 *
 *   import { evalAgentPrompt } from '@boring/agent/eval'
 *
 *   const result = await evalAgentPrompt({
 *     app,
 *     prompt: 'open README.md',
 *     expect: {
 *       tool: 'exec_ui',
 *       params: { kind: 'openFile', params: { path: 'README.md' } },
 *     },
 *   })
 *   expect(result.ok).toBe(true)
 *
 * Suite usage (CLI or script):
 *
 *   import { runEvalSuite } from '@boring/agent/eval'
 *
 *   const report = await runEvalSuite({
 *     app,
 *     fixturesPath: 'eval/standard-tools.yaml',
 *   })
 *   if (!report.allPassed) process.exit(1)
 */
export { evalAgentPrompt } from "./evalPrompt"
export { runEvalSuite } from "./runSuite"
export { parseFixtureYaml } from "./yamlSchema"
export {
  EvalAny,
  EvalRegex,
  isEvalRegex,
} from "./types"
export type {
  ToolCall,
  ExpectedCall,
  EvalAnyType,
  EvalRegexMatcher,
  EvalModelSelection,
  EvalPromptOptions,
  EvalResult,
  SuiteOptions,
  SuiteFixture,
  SuiteFixturePrompt,
  SuiteReport,
} from "./types"
export {
  someCallMatches,
  firstCallMatches,
  noToolCallMatches,
  callSatisfies,
  type MatchOutcome,
} from "./matcher"
export {
  DEFAULT_EVAL_MODEL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_SUITE_TIMEOUT_MS,
  DEFAULT_CONCURRENCY,
} from "./evalConfig"
