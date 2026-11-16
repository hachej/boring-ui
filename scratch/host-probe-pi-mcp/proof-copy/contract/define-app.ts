// The plugin contract: one definition per app, mounted by a host that holds no code of any app. Types only, plus a small validating function.
import type * as Layer from "effect/Layer";
import type { DefinedAgent } from "@hachej/boring-agent/agents";
import type { SkillSource } from "@hachej/boring-agent/agents";
import type { ToolRegistration } from "@earendil-works/pi-durable";

/** An operation as Alchemy Domain's `expose` spells it: a command name (`AddNote`) or a read (`Notes.get`). */
export type Operation = string;
/** A host capability, by name. Only `files` is built; the host refuses a name it does not know. */
export type Need = "files" | "mail";
/** What a view's React module gets from the host: the signed-in person, an operation, a read. A view imports nothing from the host. */
export interface ViewProps {
  person: { id: string; email: string };
  call(op: Operation, input?: object): Promise<unknown>;
  /** `after` is what `call` returned: the read then waits until that write is in the view (a view is a projection, a moment behind). */
  read(view: string, after?: unknown): Promise<any>;
}
export interface View { id: string; nav: string; /** path of a module whose default export is a React component of ViewProps */ component: string }
/** The host's hand to the agents factory: this person's tools for one audience, skills, ask and files tools, the model route. */
export interface AgentKit {
  person: string;
  model: { provider: string; modelId: string };
  tools(audience: string): ToolRegistration[];
  skills(agent: string): SkillSource;
  ask: ToolRegistration;
  files: ToolRegistration[];
  /** The tools of another app's MCP door, declared in `links`: they act as this person in that app once the person linked their account there. */
  linked(id: string): ToolRegistration[];
}
/** Another app this app's agent acts in, through that app's MCP door, as the same person. The door's address comes from the deploy (`LINK_<ID>`). */
export interface Link { title: string }
/** An event of the model wakes a reader agent: `policy` is the model's own Domain Policy, the host supplies its handler. */
export interface Wake<E = any> { policy: { toLayer: (...a: any[]) => Layer.Layer<any, any, any> }; agent: string; key(event: E): string; message(event: E): string }
export interface Seed { people: { name: string; email: string }[]; operations: { as: string; op: Operation; input: object }[] }

export interface AppDefinition {
  name: string; title: string;
  models: readonly { layer: (handlers: Layer.Layer<any, any, any>) => Layer.Layer<any, any, any> }[];
  handlers: Layer.Layer<any, any, any>;
  api: unknown;
  /** One explicit list per audience: `page`, `mcp`, and the name of each agent that gets tools. */
  expose: { page: readonly Operation[]; mcp?: readonly Operation[]; [audience: string]: readonly Operation[] | undefined };
  views: readonly View[];
  /** boring-agent's own `defineAgent`, called with this person's kit. One of them is named `assistant`. */
  agents?: (kit: AgentKit) => Record<string, DefinedAgent>;
  /** A folder `<agent>/<skill>/SKILL.md`, read when the page and the Worker are built. */
  skills?: string;
  wakes?: readonly Wake[];
  seed?: Seed;
  needs?: readonly Need[];
  links?: Readonly<Record<string, Link>>;
}

const NEEDS = ["files", "mail"];
export const defineApp = <const A extends AppDefinition>(app: A): A => {
  const fail = (why: string): never => { throw new Error(`defineApp(${app.name}): ${why}`); };
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(app.name)) fail("name: lowercase letters, digits, hyphens");
  if (new Set(app.views.map((v) => v.id)).size !== app.views.length || app.views.length === 0) fail("views: at least one, each id once");
  if (app.expose.page.length === 0) fail("expose.page is empty: a person has no button");
  for (const id of Object.keys(app.links ?? {})) if (!/^[a-z][a-z0-9]{1,15}$/.test(id) || id === app.name) fail(`links: bad id ${id}`);
  for (const n of app.needs ?? []) if (!NEEDS.includes(n)) fail(`needs: unknown capability ${n}`);
  for (const w of app.wakes ?? []) {
    if (!app.agents) fail(`wakes ${w.agent}: the app has no agents`);
    if (!app.expose[w.agent]?.length) fail(`wakes ${w.agent}: a reader needs its own expose list (its one narrow write)`);
  }
  return app;
};
