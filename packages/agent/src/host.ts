import type * as Host from './host/index.js';

/** The three packages the contract imports. They are not peers of the package (npm would walk Domain's optional peers), so this names them. */
export const HOST_PACKAGES = { '@alchemy.run/domain': '2.0.0-beta.87', effect: '4.1.4', alchemy: '2.0.0-beta.87' } as const;

const load = async (): Promise<typeof Host> => {
  try { return await import('./host/index.js'); } catch (error) {
    const text = String((error as Error)?.message ?? error);
    if (!Object.keys(HOST_PACKAGES).some((name) => text.includes(`'${name}`) || text.includes(`"${name}`))) throw error;
    const list = Object.entries(HOST_PACKAGES).map(([name, version]) => `${name}@${version}`).join(' ');
    throw new Error(`@hachej/boring-agent/host needs ${list} installed in your app: npm install --save-exact ${list}`, { cause: error });
  }
};
const host = await load();

export const { KIT_LANGUAGES, checkAgents, defineApp, mustOwn, must } = host;
export const CurrentUser = host.CurrentUser;
export type CurrentUser = Host.CurrentUser;
export const NotAllowed = host.NotAllowed;
export type NotAllowed = Host.NotAllowed;
export const NotYours = host.NotYours;
export type NotYours = Host.NotYours;
export const Role = host.Role;
export type Role = Host.Role;
export const Scope = host.Scope;
export type Scope = Host.Scope;
export const Session = host.Session;
export type Session = Host.Session;
export const Unauthorized = host.Unauthorized;
export type Unauthorized = Host.Unauthorized;
export type { AppHostProps, Assets, HostBuild, HostEntry, MountApp, MountOptions, OpenHarness, Person, ResolveLanguage, RouteName, SecretByName, WriteAttribution } from './host/contract.js';
export type { AgentKit, AppDefinition, AppWords, Format, KitLanguage, Languages, Member, Need, Operation, Seed, View, ViewProps, Wake } from './host/index.js';
