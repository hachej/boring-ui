import { toToolkit } from '@alchemy.run/domain/Ai';
import type { Toolable } from '@alchemy.run/domain/Ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Tool } from 'effect/ai';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Stream from 'effect/Stream';
import { CurrentUser, Session } from '../identity.js';
import type { AppDefinition } from '../index.js';
import { SenderUnknown, toolableApi } from './contract.js';
import type { AppTools, CheckAgentTools, CheckExpose } from './contract.js';

const PREFIX = 'host.tools.';
const REFUSED = 'refused: sender-unknown. Stop and tell the person.';

/** Domain types `expose` as `readonly never[]` for a plain `Toolable`; the names are checked against the Api by `checkAudience`. */
const exposing = (names: readonly string[]) => ({ expose: names as never });
const toolsOf = (api: Toolable, names: readonly string[]) => toToolkit(api, exposing(names)).toolkit.tools;

/** Every name of one audience gives a tool of its own: Domain keeps no tool for an unknown name or a stream, and drops a duplicate or over-long tool name. */
function checkAudience(def: AppDefinition, audience: string, api: Toolable): void {
  const fail = (operation: string, why: string): never => { throw new Error(`checkExpose(${def.name}): expose.${audience} lists ${operation}, ${why}`); };
  const names = [...new Set(def.expose[audience] ?? [])];
  const toolFor = new Map<string, string>();
  for (const name of names) {
    const [tool] = Object.keys(toolsOf(api, [name]));
    if (tool === undefined) fail(name, 'which gives no tool: not an operation of the api that returns once');
    toolFor.set(name, tool!);
  }
  if (Object.keys(toolsOf(api, names)).length < names.length) {
    const seen = new Set<string>();
    for (const [name, tool] of toolFor) { if (seen.has(tool)) fail(name, `which gives the tool name ${tool} again`); seen.add(tool); }
  }
}

export const checkExpose: CheckExpose = (def) => {
  const api = toolableApi(def);
  for (const audience of Object.keys(def.expose)) checkAudience(def, audience, api);
};

export const checkAgentTools: CheckAgentTools = (def, agents) => {
  const fail = (agent: string, why: string): never => { throw new Error(`checkAgentTools(${def.name}): agent ${agent} ${why}`); };
  for (const [id, agent] of Object.entries(agents)) {
    for (const { name } of agent.extensions) if (name.startsWith(PREFIX) && name !== `${PREFIX}${id}`) fail(id, `holds ${name}, the tools of another agent`);
  }
  const walk = (caller: { readonly id: string; readonly delegates: readonly (typeof agents)[string][] }, visited: Set<string>): void => {
    if (visited.has(caller.id)) return;
    visited.add(caller.id);
    const held = new Set(def.expose[caller.id] ?? []);
    for (const delegate of caller.delegates) {
      for (const operation of def.expose[delegate.id] ?? []) if (!held.has(operation)) fail(delegate.id, `exposes ${operation}, which its caller ${caller.id} does not hold`);
      walk(delegate, visited);
    }
  };
  for (const agent of Object.values(agents)) walk(agent, new Set());
};

type Handled = { readonly isFailure: boolean; readonly encodedResult: unknown };

/** One agent's tools as one Extension. Built once; everything that changes per call (who, which scope, the Layer) is read inside the call. */
export const appTools: AppTools = ({ def, api, agent, scope, services, attribution, commandId }) => {
  checkAudience(def, agent, api);
  const toolkit = toToolkit(api, exposing(def.expose[agent] ?? []));
  return defineExtension({
    name: `${PREFIX}${agent}`,
    tools: Object.values(toolkit.toolkit.tools).map((tool) => {
      const readonly = Context.get(tool.annotations, Tool.Readonly);
      return defineTool({
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: Tool.getJsonSchema(tool) as object,
        ...(readonly ? { replay: 'safe' as const } : {}),
        execute: async (args, call, context) => {
          let requestedBy: string;
          try { ({ requestedBy } = await attribution(call, context)); }
          catch (error) {
            if (error instanceof SenderUnknown) return { output: [{ type: 'text', text: REFUSED }], isError: true };
            throw error;
          }
          const params = readonly || commandId === undefined ? args : { ...args as object, commandId: await commandId(call, context) };
          const caller = { userId: requestedBy, ...(scope ? { scope } : {}) };
          const session = Layer.succeed(Session, (effect) => Effect.provideService(effect, CurrentUser, caller));
          const handled = await Effect.runPromise(Effect.gen(function* () {
            const handlers = yield* toolkit.toolkit;
            const stream = yield* handlers.handle(tool.name, params as never, call.callId);
            return (yield* Stream.runCollect(stream)).at(-1) as Handled;
          }).pipe(Effect.provide(toolkit.layer), Effect.provide(session), Effect.provideContext(services()), Effect.scoped));
          return { output: [{ type: 'text', text: JSON.stringify(handled.encodedResult) }], isError: handled.isFailure };
        },
      });
    }),
  });
};
