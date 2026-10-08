import type { PresentationCommand, PresentationResult, ViewerTarget } from '@hachej/boring-ui-kit/contracts';
import type { Context } from '@earendil-works/chord';
import type { Static, TSchema } from '@earendil-works/pi-ai';
import { defineTool, type ToolExecutionApi, type ToolExecutionResult, type ToolRegistration } from '@earendil-works/pi-durable';

export interface PresentationToolOptions<P extends TSchema, Input, Output, Subject> {
  readonly name: string;
  readonly description: string;
  readonly parameters: P;
  readonly command: PresentationCommand<Input, Output, Subject>;
  readonly target: ViewerTarget<Subject>;
  readonly prepareInput: (args: Static<P>) => Input;
  readonly authorize: (input: Input, target: ViewerTarget<Subject>, api: ToolExecutionApi, context: Context) => boolean | Promise<boolean>;
  readonly formatResult: (result: PresentationResult<Output, Subject>) => ToolExecutionResult;
}

/** Bind one captured viewer target to a native, non-replayable tool. Target and parsed input must be structured-cloneable. */
export function createPresentationTool<P extends TSchema, Input, Output, Subject>(
  options: PresentationToolOptions<P, Input, Output, Subject>,
): ToolRegistration<P> {
  const target = structuredClone(options.target);
  const { command, prepareInput, authorize, formatResult } = options;
  const parse = command.input.parse;
  const invoke = command.invoke;
  function format(result: PresentationResult<Output, Subject>): ToolExecutionResult {
    const refused = result.kind !== 'applied' && result.kind !== 'proposed';
    const formatted = formatResult(result);
    return refused ? { ...formatted, isError: true } : formatted;
  }
  return defineTool({
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    replay: 'unsafe',
    execute: async (args, api, context) => {
      const signal = context.abortSignal;
      signal?.throwIfAborted();
      const prepared = prepareInput(args);
      let input: Input;
      try { input = parse(prepared); }
      catch { return format({ kind: 'denied', reason: 'Invalid presentation command input' }); }
      const retainedInput = structuredClone(input);
      const allowed = await authorize(structuredClone(retainedInput), structuredClone(target), api, context);
      signal?.throwIfAborted();
      if (allowed !== true) return format({ kind: 'denied', reason: 'Presentation command authorization denied' });
      const result = await invoke(structuredClone(target), retainedInput, signal);
      signal?.throwIfAborted();
      return format(result);
    },
  });
}
