import type * as Layer from 'effect/Layer';
import type { Extension, ToolRegistration } from '@earendil-works/pi-durable';
import type { DefinedAgent, SkillSource } from '../agents.js';
import type { Role } from './identity.js';
import type { PlainOps } from './op.js';

/** An operation as `expose` spells it: Alchemy Domain's command name (`AddNote`) or read (`Notes.get`), or a plain operation's name (`addNote`). */
export type Operation = string;
/** A host capability, by name. Only `files` is built. */
export type Need = 'files';

/** The languages the kit speaks. It grows by a kit release only. */
export const KIT_LANGUAGES = ['en', 'fr'] as const;
export type KitLanguage = (typeof KIT_LANGUAGES)[number];

/** The keys the host reads in every words file. The rest of a words file is the app's own. */
export interface AppWords {
  readonly app: { readonly title: string };
  /** One name per view id, shown in the navigation. */
  readonly views: Readonly<Record<string, string>>;
  /** One sentence per rejection tag of the models. */
  readonly refusals: Readonly<Record<string, string>>;
}

export interface Languages<W extends AppWords = AppWords> {
  /** The language the base words are written in. A key missing in another table shows the base's text, never the key. */
  readonly base: KitLanguage;
  /** One table per language the app speaks, the base included. */
  readonly words: Partial<Record<KitLanguage, W>>;
  /** The region for formats when a person's tag has none (`de` becomes `de-CH`). */
  readonly region?: string;
}

/** What the host formats for a person, on `Intl`; the runtime supplies the implementation. */
export interface Format {
  readonly locale: string;
  date(at: Date | string, style?: 'short' | 'medium' | 'long'): string;
  time(at: Date | string): string;
  number(n: number, digits?: number): string;
  money(amount: number, currency: string): string;
  list(items: readonly string[]): string;
  plural<T>(n: number, forms: { one: T; other: T; zero?: T; two?: T; few?: T; many?: T }): T;
  compare(a: string, b: string): number;
}

/** What a view's React module gets from the host. A view imports nothing from the host. */
export interface ViewProps<W extends AppWords = AppWords> {
  person: { id: string; email: string };
  /** The person's language tag, such as `de-CH`. */
  language: string;
  words: W;
  format: Format;
  /** A refusal in the person's language: `refusals.<Tag>`, never the tag. */
  say(error: unknown): string;
  call(op: Operation, input?: object): Promise<unknown>;
  /** `after` is what `call` returned: the read then waits until that write is in the view. */
  read(view: string, after?: unknown): Promise<any>;
}

export interface View {
  id: string;
  /** Path of a module whose default export is a React component of `ViewProps`. */
  component: string;
  nav?: never;
  rightPane?: never;
}

/** The host's hand to the agents factory: one agent's tools as one Extension, skills, ask and files tools, the model route. */
export interface AgentKit {
  /** The session's unit key: the person's id on `me:<id>`, the unit on `reader:<unit>` and on a shared session. */
  person: string;
  model: { provider: string; modelId: string };
  tools(agent: string): Extension;
  skills(agent: string): SkillSource;
  ask: ToolRegistration;
  files: ToolRegistration[];
}

/** An event of the model wakes a reader agent: `policy` is the model's own Domain Policy, the host supplies its handler. */
export interface Wake<E = any> {
  policy: { toLayer: (...a: any[]) => Layer.Layer<any, any, any> };
  agent: string;
  key(event: E): string;
  message(event: E): string;
}

/**
 * The seed's rule, the same for every runner of it: an operation carries no target, so each one is applied as its person
 * (`as`, by e-mail) on that person's own id as the target key. A person's first notebook is therefore keyed by their own id.
 */
export interface Seed {
  /** `language` is a BCP 47 tag. */
  people: { name: string; email: string; language?: string }[];
  operations?: { as: string; op: Operation; input: object }[];
}

export interface AppDefinition<W extends AppWords = AppWords> {
  name: string;
  languages: Languages<W>;
  /** The Alchemy Domain form: `models`, `handlers` and `api` come together, or none (an app of plain operations only). */
  models?: readonly { layer: (handlers: Layer.Layer<any, any, any>) => Layer.Layer<any, any, any> }[];
  handlers?: Layer.Layer<never, any, any>;
  api?: unknown;
  /** The plain form: TypeScript operations, each a tool of an agent. An app has `api`, `ops`, or both. */
  ops?: PlainOps;
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
  /** A shared unit: the view the door reads as the person, and where its members live. An app with none has personal sessions only. */
  units?: { view: Operation; members(state: unknown): ReadonlyArray<{ userId: string; role: Role }> };
  title?: never;
  model?: never;
}

const NEEDS: readonly string[] = ['files'];
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Refuses a malformed definition at definition time. It cannot see agent names: `checkAgents` does at mount. */
export const defineApp = <const A extends AppDefinition>(app: A): A => {
  const fail = (why: string): never => { throw new Error(`defineApp(${app?.name}): ${why}`); };
  if (!app || typeof app !== 'object') fail('the definition is not an object');
  if (typeof app.name !== 'string' || !/^[a-z][a-z0-9-]{1,20}$/.test(app.name)) fail('name: lowercase letters, digits, hyphens');
  const { languages } = app;
  if (!languages || typeof languages !== 'object') return fail('languages: required, with a base language and its words');
  if (!(KIT_LANGUAGES as readonly string[]).includes(languages.base)) fail(`languages.base: ${languages.base} is not a kit language`);
  for (const l of Object.keys(languages.words ?? {})) if (!(KIT_LANGUAGES as readonly string[]).includes(l)) fail(`languages.words: ${l} is not a kit language`);
  if (!Array.isArray(app.views) || app.views.some((v) => !v || typeof v !== 'object')) fail('views: required, a list of views with at least one');
  if (!app.expose || typeof app.expose !== 'object' || !Array.isArray(app.expose.page)) fail('expose: required, with a page list');
  const base = languages.words?.[languages.base];
  if (!base) fail(`languages.words: no words for the base language ${languages.base}`);
  if (!text(base?.app?.title)) fail(`languages.words.${languages.base}.app.title: missing`);
  if (app.views.length === 0 || new Set(app.views.map((v) => v.id)).size !== app.views.length) fail('views: at least one, each id once');
  for (const v of app.views) if (!text(base?.views?.[v.id])) fail(`views.${v.id}: no languages.words.${languages.base}.views.${v.id}`);
  for (const [l, table] of Object.entries(languages.words)) {
    if (l === languages.base) continue;
    const at = `languages.words.${l}`;
    if (!table || typeof table !== 'object') fail(`${at}: not a words table`);
    if (!text(table.app?.title)) fail(`${at}.app.title: missing`);
    for (const id of Object.keys(base?.views ?? {})) if (!text(table.views?.[id])) fail(`${at}.views.${id}: missing, the base language has it`);
    for (const tag of Object.keys(base?.refusals ?? {})) if (!text(table.refusals?.[tag])) fail(`${at}.refusals.${tag}: missing, the base language has it`);
    for (const id of Object.keys(table.views ?? {})) if (!Object.hasOwn(base?.views ?? {}, id)) fail(`${at}.views.${id}: the base language has no such view`);
    for (const tag of Object.keys(table.refusals ?? {})) if (!Object.hasOwn(base?.refusals ?? {}, tag)) fail(`${at}.refusals.${tag}: the base language has no such refusal`);
  }
  const forms = [['models', app.models], ['handlers', app.handlers], ['api', app.api]] as const;
  if (!app.ops && forms.every(([, v]) => v === undefined)) fail('neither api nor ops: the app has no operation');
  const missing = forms.filter(([, v]) => v === undefined).map(([k]) => k);
  if (missing.length > 0 && missing.length < 3) fail(`${missing.join(', ')}: missing; models, handlers and api come together`);
  if (app.expose.page.length === 0) fail('expose.page is empty: a person has no button');
  for (const n of app.needs ?? []) if (!NEEDS.includes(n)) fail(`needs: unknown capability ${n}`);
  if (app.units && !app.expose.page.includes(app.units.view)) fail(`units.view ${app.units.view} is not in expose.page`);
  for (const w of app.wakes ?? []) {
    if (!w || typeof w.agent !== 'string') fail('wakes: each wake names its agent');
    if (!app.agents) fail(`wakes ${w.agent}: the app has no agents`);
    if (!Object.hasOwn(app.expose, w.agent) || !app.expose[w.agent]?.length) fail(`wakes ${w.agent}: a reader needs its own expose list (its one narrow write)`);
  }
  return app;
};

/** The host calls this at mount with the record `agents(kit)` returned. */
export const checkAgents = (app: AppDefinition, agents: Record<string, DefinedAgent>): void => {
  const fail = (why: string): never => { throw new Error(`checkAgents(${app?.name}): ${why}`); };
  if (!app?.expose) fail('the definition has no expose');
  if (!agents || typeof agents !== 'object') fail('agents: the factory returned no record');
  const has = (name: string) => Object.hasOwn(agents, name);
  if (!has('assistant')) fail('agents: no agent named assistant');
  for (const [key, a] of Object.entries(agents)) if (!a || typeof a !== 'object') fail(`agents.${key}: not an agent`); else if (a.id !== key) fail(`agents.${key}: key differs from the agent's id ${a.id}`);
  for (const audience of Object.keys(app.expose)) {
    if (audience !== 'page' && audience !== 'mcp' && !has(audience)) fail(`expose.${audience}: not page, mcp or an agent's name`);
  }
  for (const w of app.wakes ?? []) if (!has(w.agent)) fail(`wakes ${w.agent}: not an agent's name`);
};
