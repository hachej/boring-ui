import { toToolkit, toolName } from '@alchemy.run/domain/Ai';
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

const MAX_TOOL_NAME = 64;
/** The tool names Domain would give an operation: a read `Name.op` has one, a command or query `Name` has `send` or `ask`. */
const toolNamesOf = (api: Toolable, operation: string): string[] => {
  const [name = operation, read] = operation.split('.');
  return (read ? [read] : ['send', 'ask']).map((op) => toolName({ api: api.apiName, name, operation: op }));
};

/** Every name of one audience gives a tool: Domain keeps none for an unknown name, a stream or a tool name past 64 characters. */
function checkAudience(def: AppDefinition, audience: string, api: Toolable): void {
  const fail = (operation: string, why: string): never => { throw new Error(`checkExpose(${def.name}): expose.${audience} lists ${operation}, ${why}`); };
  for (const name of new Set(def.expose[audience] ?? [])) {
    if (Object.keys(toolsOf(api, [name])).length > 0) continue;
    const long = toolNamesOf(api, name).find((tool) => tool.length > MAX_TOOL_NAME);
    fail(name, long ? `which gives no tool: its tool name ${long} passes ${MAX_TOOL_NAME} characters` : 'which gives no tool: not an operation of the api that returns once');
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
  const toolNames = (agent: Defined, skipOwn: boolean) => agent.extensions.filter((_, i) => !(skipOwn && i === 0)).flatMap((extension) => (extension.tools ?? []).map((tool) => tool.name));
  /**
   * A delegate holds only what its caller holds: its exposed operations, and every tool its extensions carry, whatever they are
   * named. A delegate with delegates of its own has a delegate tool in its own (first) extension, which no caller lists, so that
   * extension is skipped for it. A tool an app extension builds by hand that calls the domain itself cannot be seen here.
   */
  const walk = (caller: Defined, visited: Set<string>): void => {
    if (visited.has(caller.id)) return;
    visited.add(caller.id);
    const held = new Set(def.expose[caller.id] ?? []);
    const heldTools = new Set(toolNames(caller, false));
    const domainTools = (agent: Defined) => new Set(agent.extensions.filter((e) => e.name === `${PREFIX}${agent.id}`).flatMap((e) => (e.tools ?? []).map((tool) => tool.name)));
    const callerDomain = domainTools(caller);
    for (const delegate of caller.delegates) {
      for (const operation of def.expose[delegate.id] ?? []) if (!held.has(operation)) fail(delegate.id, `exposes ${operation}, which its caller ${caller.id} does not hold`);
      const ownDomain = domainTools(delegate);
      for (const tool of toolNames(delegate, delegate.delegates.length > 0)) {
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

/** What the model sees of a command: Domain offers it a `commandId`, which would let it replay another command's stored reply past the scope. */
const offered = (tool: Tool.Any, write: boolean) => {
  const schema = Tool.getJsonSchema(tool);
  if (!write || !schema.properties) return schema;
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => key !== 'commandId'));
  return { ...schema, properties,...(Array.isArray(schema.required) ? { required: schema.required.filter((key) => key !== 'commandId') } : {}) };
};

/** A command goes to Domain as its target and input and the host's own command id: never an id the model chose. A read passes as given. */
const payloadOf = (args: Record<string, Schema.Json>, write: boolean, id: string | undefined): Record<string, Schema.Json> =>
  write ? { target: args.target ?? null, input: args.input ?? null, ...(id === undefined ? {} : { commandId: id }) } : args;

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
