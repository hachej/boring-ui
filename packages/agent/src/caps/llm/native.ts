// The provider's own structured output, where pi-ai's request can carry it: Anthropic's `output_config.format`, added through pi-ai's
// `onPayload` (pi sets `output_config` only for effort). The reply is then the value itself, read directly and still checked.
import type { Model } from '@earendil-works/pi-ai';
import { schemaCheck } from './structured-port.js';

/** Whether this model's API takes a JSON schema natively; any other API keeps the envelope of `structured-port.ts`. */
export const nativeFormat = (model: Model<any> | undefined): boolean => model?.api === 'anthropic-messages';

/** The payload hook: the schema joins `output_config`, the effort pi already set there is kept. */
export const withFormat = (schema: object) => (payload: unknown) => {
  const p = payload as { output_config?: Record<string, unknown> };
  return { ...p, output_config: { ...p.output_config, format: { type: 'json_schema', schema } } };
};

/** The reply as the value, checked against the schema: `{ value }`, or the problem a corrective turn names. */
export function readNative(schema: object, text: string): { value: unknown } | { problem: string } {
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')); } catch { return { problem: 'not JSON' }; }
  const problem = schemaCheck().check(schema, value, '$');
  return problem ? { problem } : { value };
}
