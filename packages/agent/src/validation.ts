import { defineExtension, defineTask } from '@earendil-works/pi-durable';
import type { EntryId, Harness, TaskId } from '@earendil-works/pi-durable';
import type { Context, JsonValue } from '@earendil-works/chord';
import { isJsonValue } from '@earendil-works/chord';
import { readToolEvidence } from './tool-evidence.js';
import type { NativeToolEvidence } from './tool-evidence.js';
export type { NativeToolEvidence } from './tool-evidence.js';

export type OutputProposal = { readonly text: string; readonly evidence: readonly EntryId[] };
export type ValidationResult<T extends JsonValue> = { kind: 'valid'; value: T } | { kind: 'invalid'; errors: readonly string[] };
export type OutputValidationResult<T extends JsonValue> = ValidationResult<T> | { kind: 'producer-failed'; status: string };
export interface OutputValidationOptions<T extends JsonValue> {
  readonly name: string;
  readonly version: number;
  readonly harness: () => Harness;
  readonly authorize: (owner: TaskId, evidence: readonly NativeToolEvidence[], context: Context) => boolean | Promise<boolean>;
  readonly validate: (text: string, evidence: readonly NativeToolEvidence[], context: Context) => ValidationResult<T> | Promise<ValidationResult<T>>;
}

export function createOutputValidation<T extends JsonValue>(options: OutputValidationOptions<T>) {
  const { name, version, harness, authorize, validate } = options;
  if (!name || name.startsWith('pi.') || !Number.isSafeInteger(version) || version < 1) throw new TypeError('A host validation name and positive version are required');
  const invalid = (message: string): ValidationResult<T> => ({ kind: 'invalid', errors: [message] });
  async function check(proposal: OutputProposal, owner: TaskId, context: Context): Promise<ValidationResult<T>> {
    if (!proposal || typeof proposal.text !== 'string' || !Array.isArray(proposal.evidence) || !proposal.evidence.length || proposal.evidence.length > 64
      || proposal.evidence.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(proposal.evidence).size !== proposal.evidence.length) return invalid('Actual distinct tool result references are required');
    const text = proposal.text;
    const ids = Array.from(proposal.evidence);
    try {
      const evidence = await readToolEvidence(harness(), owner, ids, context);
      if (await authorize(owner, structuredClone(evidence), context) !== true) return invalid('Tool evidence is not authorized');
      const returned = await validate(text, structuredClone(evidence), context);
      let result: ValidationResult<T>;
      if (returned?.kind === 'valid') {
        const value = returned.value;
        if (!isJsonValue(value)) return invalid('Validator did not return a JSON value');
        result = { kind: 'valid', value: structuredClone(value) };
      } else if (returned?.kind === 'invalid') {
        const supplied = returned.errors;
        if (!Array.isArray(supplied)) return invalid('Validator did not return errors');
        const errors = Array.from(supplied);
        if (!errors.length || errors.some(error => typeof error !== 'string')) return invalid('Validator did not return errors');
        result = { kind: 'invalid', errors };
      } else return invalid('Validator did not return a valid result');
      if (await authorize(owner, structuredClone(evidence), context) !== true) return invalid('Tool evidence is no longer authorized');
      return result;
    } catch {
      return invalid('Native tool evidence or validation is unavailable');
    }
  }
  const task = defineTask<{ producer: TaskId<OutputProposal> }, { phase: 'wait' } | { phase: 'validate' }, OutputValidationResult<T>>({
    name, version, initial: () => ({ phase: 'wait' }),
    phases: {
      wait: async (running, runtime, context) => {
        await runtime.commit(() => ({ status: 'waiting', on: [running.input.producer], policy: 'allSettled', checkpoint: { phase: 'validate' } }), context);
      },
      validate: async (running, runtime, context) => {
        const [outcome] = await runtime.outcomes([running.input.producer], context);
        if (!outcome) throw new Error('Native producer outcome is missing');
        const result: OutputValidationResult<T> = outcome.status === 'completed'
          ? await check(outcome.result, running.input.producer, context)
          : { kind: 'producer-failed', status: outcome.status };
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), context);
      },
    },
    abort: async (_running, runtime, context) => {
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context);
    },
  });
  return { task, extension: defineExtension({ name, tasks: [task] }), check };
}
