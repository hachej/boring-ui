import { toToolkit } from '@alchemy.run/domain/Ai';
import type { Toolable } from '@alchemy.run/domain/Ai';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Tool } from 'effect/ai';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as Schema from 'effect/Schema';
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

/**
 * Every name of one audience gives a tool: Domain keeps none for an unknown name, a stream or a tool name past 64 characters. The
 * reason is told by what the Api serves (`group.requests` lists every call, streams included) and by the same Api under a short name.
 */
function checkAudience(def: AppDefinition, audience: string, api: Toolable): void {
  const fail = (operation: string, why: string): never => { throw new Error(`checkExpose(${def.name}): expose.${audience} lists ${operation}, which gives no tool: ${why}`); };
  const shortNamed: Toolable = { apiName: 'x', serves: api.serves, group: api.group, clientInProcess: api.clientInProcess };
  for (const name of new Set(def.expose[audience] ?? [])) {
    if (Object.keys(toolsOf(api, [name])).length > 0) continue;
    if (!api.group.requests.has(name)) fail(name, 'not an operation of the api');
    fail(name, Object.keys(toolsOf(shortNamed, [name])).length > 0 ? `the tool name of the api ${api.apiName} passes 64 characters` : 'it is a stream (watch or events), not one tool result');
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
  type Defined = (typeof agents)[string];
  /** The `delegate` and `delegate_*` tools of an agent that has delegates are the hand-over itself, not something a caller must hold. */
  const toolNames = (agent: Defined) => agent.extensions.flatMap((extension) => (extension.tools ?? []).map((tool) => tool.name))
    .filter((name) => agent.delegates.length === 0 || !/^delegate(_|$)/.test(name));
  /**
   * A delegate holds only what its caller holds: its exposed operations, and every tool its extensions carry, whatever they are
   * named. A tool an app extension builds by hand that calls the domain itself cannot be seen here.
   */
  const walk = (caller: Defined, visited: Set<string>): void => {
    if (visited.has(caller.id)) return;
    visited.add(caller.id);
    const held = new Set(def.expose[caller.id] ?? []);
    const heldTools = new Set(toolNames(caller));
    const domainTools = (agent: Defined) => new Set(agent.extensions.filter((e) => e.name === `${PREFIX}${agent.id}`).flatMap((e) => (e.tools ?? []).map((tool) => tool.name)));
    const callerDomain = domainTools(caller);
    for (const delegate of caller.delegates) {
      for (const operation of def.expose[delegate.id] ?? []) if (!held.has(operation)) fail(delegate.id, `exposes ${operation}, which its caller ${caller.id} does not hold`);
      const ownDomain = domainTools(delegate);
      for (const tool of toolNames(delegate)) {
        if (callerDomain.has(tool) && !ownDomain.has(tool)) fail(delegate.id, `holds the tool ${tool} of its caller ${caller.id}, outside its own list`);
        if (!heldTools.has(tool)) fail(delegate.id, `holds the tool ${tool}, which its caller ${caller.id} does not hold`);
      }
      walk(delegate, visited);
    }
  };
  for (const agent of Object.values(agents)) walk(agent, new Set());
};

/** pi validated the arguments against the tool's JSON schema before `execute`, so they are JSON; the one place that says so. */
const argsOf = (args: unknown) => args as Record<string, Schema.Json>;

/**
 * What the model sees of a tool. Domain offers a command a `commandId`, which would let the model replay another command's stored
 * reply past the scope; it offers a read `atLeast`, which makes the read wait (about 11 s) for a stream version the model names. The
 * card needs neither: the host chooses the command id, and nothing in an agent's turn waits for its own write to reach a view.
 */
const withheld = (write: boolean) => (write ? 'commandId' : 'atLeast');
const offered = (tool: Tool.Any, write: boolean) => {
  const schema = Tool.getJsonSchema(tool);
  if (!schema.properties) return schema;
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== withheld(write)));
  return { ...schema, properties, ...(Array.isArray(schema.required) ? { required: schema.required.filter((key) => key !== withheld(write)) } : {}) };
};

/** A command goes to Domain as its target and input and the host's own command id: never an id the model chose. A read goes without `atLeast`. */
const payloadOf = (args: Record<string, Schema.Json>, write: boolean, id: string | undefined): Record<string, Schema.Json> => {
  if (write) return { target: args.target ?? null, input: args.input ?? null, ...(id === undefined ? {} : { commandId: id }) };
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== withheld(false)));
};

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
        parameters: offered(tool, !readonly),
        ...(readonly ? { replay: 'safe' as const } : {}),
        execute: async (args, call, context) => {
          let requestedBy: string;
          try { ({ requestedBy } = await attribution(call, context)); }
          catch (error) {
            if (error instanceof SenderUnknown) return { output: [{ type: 'text', text: REFUSED }], isError: true };
            throw error;
          }
          const params = payloadOf(argsOf(args),!readonly, commandId && await commandId(call, context));
          const caller = { userId: requestedBy, ...(scope ? { scope } : {}) };
          const session = Layer.succeed(Session, (effect) => Effect.provideService(effect, CurrentUser, caller));
          const handled = await Effect.runPromise(Effect.gen(function* () {
            const handlers = yield* toolkit.toolkit;
            const stream = yield* handlers.handle(tool.name, params, call.callId);
            return (yield* Stream.runCollect(stream)).at(-1);
          }).pipe(Effect.provide(toolkit.layer), Effect.provide(session), Effect.provideContext(services()), Effect.scoped));
          if (!handled) throw new Error(`${tool.name} gave no result`);
          return { output: [{ type: 'text', text: JSON.stringify(handled.encodedResult) }], isError: handled.isFailure };
        },
      });
    }),
  });
};
