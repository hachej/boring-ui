// The Better Auth instance of one app (plain Better Auth, built directly): e-mail and password, Google when its client is set, by
// invitation only, with Better Auth's own rate limits kept in the app's database, and the OAuth provider that lets a person's assistant
// (Claude Code, claude.ai) sign in to /mcp with dynamic registration and PKCE. Better Auth's tables and the invitation list are created
// or extended on the first request after a deploy (getMigrations).
//
// Who is an owner:
// - In an app linked to Studio, only a person who came through Studio and whose Studio id is on Studio's signed owner list (studio.ts).
//   The app's own list holds members only.
// - Elsewhere (Studio itself, an unlinked app), an owner row of the invitation list. The first one comes from the one-use first-owner
//   link, whose SHA-256 the stack holds: a sign-up that carries the link's token while no owner exists becomes the owner. So the first
//   owner proves they hold the link, never just an e-mail address.
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { bearer } from 'better-auth/plugins/bearer';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { jwt } from 'better-auth/plugins/jwt';
import { getCurrentAdapter } from '@better-auth/core/context';
import { oauthProvider } from '@better-auth/oauth-provider';
import { STUDIO, studioLink, type StudioClientOptions } from './studio.js';
import { say } from './words.js';

/** OAuth for MCP and for the apps Studio links: the scopes a client may ask. */
export const MCP_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export type Role = 'owner' | 'member';
export interface Person { readonly id: string; readonly email: string; readonly name: string; readonly role: Role }

export interface SignInOptions {
  /** The app's database: a D1 binding on Workers, or a `node:sqlite` DatabaseSync in tests. */
  readonly database: unknown;
  /** Better Auth's secret (a stack secret, never in git). */
  readonly secret: string;
  /** The request's origin: Better Auth's baseURL, the issuer and the /mcp resource are under it. */
  readonly origin: string;
  /** The app's name, as people read it. */
  readonly appName: string;
  /** SHA-256 (hex) of the one-use first-owner link's token; the token itself is printed once and kept nowhere. */
  readonly firstOwnerHash?: string | undefined;
  readonly google?: { readonly clientId: string; readonly clientSecret: string } | undefined;
  /** An app linked to Studio: its owners are Studio's owners, proven by a round trip through Studio. */
  readonly studio?: StudioClientOptions | undefined;
  /** Studio itself: it signs its owner list for the apps it links (`/api/signin/owners`) and registers their clients (`linkApp`). */
  readonly provider?: boolean | undefined;
  /** Sign-ups per hour from one address (Better Auth's limiter); 20 by default. */
  readonly signUpsPerHour?: number | undefined;
  readonly waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
}

type Where = { field: string; value: unknown }[];
interface Adapter {
  findOne<T>(q: { model: string; where: Where }): Promise<T | null>;
  findMany<T>(q: { model: string; where?: Where; sortBy?: { field: string; direction: 'asc' | 'desc' } }): Promise<T[]>;
  create<T>(q: { model: string; data: Record<string, unknown> }): Promise<T>;
  update<T>(q: { model: string; where: Where; update: Record<string, unknown> }): Promise<T | null>;
  delete(q: { model: string; where: Where }): Promise<void>;
}

/** The invitation list: who may create an account, and with which role. A Better Auth plugin, so its table migrates with the others. */
const invitations = () => ({
  id: 'boring-invitations',
  schema: { invitation: { fields: {
    email: { type: 'string', required: true, unique: true },
    role: { type: 'string', required: true },
    invitedBy: { type: 'string', required: true },
    createdAt: { type: 'date', required: true },
  } } },
});

export const normalEmail = (email: string) => email.trim().toLowerCase();

export function makeAuth(options: SignInOptions) {
  const origin = new URL(options.origin).origin;
  const link = options.studio ? studioLink(options.studio) : undefined;
  // Vouched for in this request: the e-mail that carried the first-owner link, and the Studio owners who came back from Studio.
  const pending = { firstOwner: '', studioOwners: new Set<string>() };
  // Inside Better Auth's own transaction (a hook during sign-up) the transaction's adapter, else the plain one: a second connection would wait on the first.
  const adapter = async () => await getCurrentAdapter((await auth.$context).adapter as never) as unknown as Adapter;
  const invitationOf = async (email: string) => (await adapter()).findOne<{ email: string; role: string }>({ model: 'invitation', where: [{ field: 'email', value: normalEmail(email) }] });
  const hasOwner = async () => !!await (await adapter()).findOne({ model: 'invitation', where: [{ field: 'role', value: 'owner' }] });

  /** A person's role, worked out at each request (module comment); undefined when they are on no list. */
  const roleOf = async (user: { id: string; email: string }): Promise<Role | undefined> => {
    const invited = await invitationOf(user.email);
    if (!link) return invited ? (invited.role === 'owner' ? 'owner' : 'member') : undefined;
    const account = await (await adapter()).findOne<{ accountId: string }>({ model: 'account', where: [{ field: 'userId', value: user.id }, { field: 'providerId', value: STUDIO }] });
    if (account && (await link.ownerSubs()).has(account.accountId)) return 'owner';
    return invited ? 'member' : undefined;
  };

  const plugins: unknown[] = [bearer(), jwt(), invitations(), oauthProvider({
    loginPage: '/sign-in',
    consentPage: '/consent',
    scopes: MCP_SCOPES,
    resources: [{ identifier: `${origin}/mcp`, accessTokenTtl: 3600 }],
    resourceSeedMode: 'insertOnly',
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultResources: [`${origin}/mcp`],
    clientRegistrationAllowedResources: [`${origin}/mcp`],
    clientRegistrationAllowedScopes: MCP_SCOPES,
    clientRegistrationRequirePKCE: true,
    grantTypes: ['authorization_code', 'refresh_token'],
    // Clients made by a signed-in person (not an assistant's own registration): owners only.
    clientPrivileges: async ({ user }: { user: { id: string; email: string } }) => (await roleOf(user)) === 'owner',
  } as never)];
  if (link) plugins.push(genericOAuth({ config: [link.provider((email, owner) => { if (owner) pending.studioOwners.add(email); })] as never }));

  const settings = {
    database: options.database,
    secret: options.secret,
    baseURL: origin,
    basePath: '/api/auth',
    emailAndPassword: { enabled: true },
    ...(options.google ? { socialProviders: { google: { clientId: options.google.clientId, clientSecret: options.google.clientSecret } } } : {}),
    plugins,
    // Better Auth's own limiter, kept in the app's database so every isolate counts the same; sign-ups also per hour.
    rateLimit: { enabled: true, storage: 'database', customRules: { '/sign-up/email': { window: 3600, max: options.signUpsPerHour ?? 20 } } },
    databaseHooks: { user: { create: {
      // By invitation only: an invited address, the holder of the first-owner link, or a Studio owner back from Studio.
      before: async (user: { email: string }, context?: { params?: Record<string, string> } | null) => {
        const email = normalEmail(user.email);
        if (email === pending.firstOwner || await invitationOf(email)) return;
        const viaStudio = (context?.params?.['id'] ?? context?.params?.['providerId']) === STUDIO;        if (viaStudio && pending.studioOwners.has(email)) return;
        throw new APIError('FORBIDDEN', { code: 'NOT_INVITED', message: say('NOT_INVITED', 'en') ?? 'NOT_INVITED' });
      },
      after: async (user: { email: string }) => {
        const email = normalEmail(user.email);
        if (email !== pending.firstOwner || await hasOwner()) return;
        await (await adapter()).create({ model: 'invitation', data: { email, role: 'owner', invitedBy: 'first-owner link', createdAt: new Date() } });
      },
    } } },
    telemetry: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
      ...(options.waitUntil ? { backgroundTasks: { handler: options.waitUntil } } : {}),
    },
  };
  const auth = betterAuth(settings as never);
  let migrated: Promise<unknown> | undefined;
  const ready = () => (migrated ??= getMigrations(settings as never).then((m) => m.runMigrations()).catch((e: unknown) => { migrated = undefined; throw e; }));
  return { auth, origin, ready, adapter, roleOf, hasOwner, pending, link };
}

export type Auth = ReturnType<typeof makeAuth>;
