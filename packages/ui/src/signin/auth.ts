// The Better Auth instance of one app (plain Better Auth, built directly): e-mail and password, Google when its client is set, by
// invitation only, with Better Auth's own rate limits kept in the app's database, and the OAuth provider that lets a person's assistant
// (Claude Code, claude.ai) sign in to /mcp with dynamic registration and PKCE. Better Auth's tables and the invitation list are created
// or extended on the first request after a deploy (getMigrations), once per isolate and database binding.
//
// Cost per request (24 Nov outage: ~97 D1 queries per request, from a migration and Better Auth's schema check at every request): the Better Auth
// object is built once per isolate and database binding (`makeAuth` keeps it; the key is below), the migration runs once per binding
// (`migrateOnce`; a failed run is not kept) and Better Auth's own runtime schema check is off (`advanced.database.validateSchema: false`).
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
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const FIRST_OWNER = 'x-boring-first-owner';
const isObject = (value: unknown): value is object => (typeof value === 'object' && value !== null) || typeof value === 'function';

/** Runs `run` once per database binding in this isolate (concurrent callers share the one run); a run that fails is forgotten, so the next request tries again. */
let migrations = new WeakMap<object, Promise<unknown>>();
export function migrateOnce(database: unknown, run: () => Promise<unknown>): Promise<unknown> {
  if (!isObject(database)) return run();
  const known = migrations.get(database);
  if (known) return known;
  const started: Promise<unknown> = run().catch((error: unknown) => { if (migrations.get(database) === started) migrations.delete(database); throw error; });
  migrations.set(database, started);
  return started;
}

/**
 * The sign-in object of one app, built once per isolate and database binding. The cache key is the binding itself (a WeakMap key, so it goes with the
 * binding) and, inside it, every option that shapes the object: secret, origin, app name, first-owner hash, Google client, Studio link (origin, app,
 * client id, owner, TTL), provider flag and sign-up limit. A request with other values (another origin, a rotated secret) builds its own object; at
 * most 8 stay per binding, the oldest dropped, so a request's Host cannot grow it without end. What differs per request without shaping the object
 * is not in the key and is kept current instead: `waitUntil` and the Studio `fetch` (a service binding) are read through `live`, set at every
 * call. Nothing about a person or a request is kept in the object: the first-owner link is read from the sign-up's own header.
 */
let built = new WeakMap<object, Map<string, Auth>>();
const MAX_PER_BINDING = 8;
interface Live { waitUntil: SignInOptions['waitUntil']; studioFetch: typeof fetch | undefined }
const lives = new WeakMap<Auth, Live>();
const keyOf = (o: SignInOptions) => JSON.stringify([o.secret, new URL(o.origin).origin, o.appName, o.firstOwnerHash ?? null, o.google ? [o.google.clientId, o.google.clientSecret] : null,
  o.studio ? [o.studio.origin, o.studio.app, o.studio.clientId, o.studio.owner ?? null, o.studio.ownersTtlMs ?? null] : null, !!o.provider, o.signUpsPerHour ?? null]);

/** Forgets every kept sign-in object and migration, as a new isolate would (tests: a Worker that starts again). Objects already handed out keep working. */
export function resetSignInCaches(): void {
  migrations = new WeakMap();
  built = new WeakMap();
}

export function makeAuth(options: SignInOptions): Auth {
  if (!isObject(options.database)) return buildAuth(options, { waitUntil: options.waitUntil, studioFetch: options.studio?.fetch });
  let perBinding = built.get(options.database);
  if (!perBinding) built.set(options.database, perBinding = new Map());
  const key = keyOf(options);
  let auth = perBinding.get(key);
  if (!auth) {
    const live: Live = { waitUntil: options.waitUntil, studioFetch: options.studio?.fetch };
    auth = buildAuth(options, live);
    lives.set(auth, live);
    perBinding.set(key, auth);
    if (perBinding.size > MAX_PER_BINDING) perBinding.delete(perBinding.keys().next().value!);
  }
  const live = lives.get(auth)!;
  live.waitUntil = options.waitUntil;
  live.studioFetch = options.studio?.fetch;
  return auth;
}

function buildAuth(options: SignInOptions, live: Live) {
  const origin = new URL(options.origin).origin;
  const link = options.studio ? studioLink({ ...options.studio, fetch: (input, init) => (live.studioFetch ?? fetch)(input, init) }) : undefined;
  // Vouched for by Studio: the owners who came back from Studio, each used once by the sign-up that follows. (The first-owner link is not kept here:
  // it is read from the sign-up's own header, so one request's proof never reaches another.)
  const pending = { studioOwners: new Set<string>() };
  /** Whether a first-owner token is good now: it is the link's (`firstOwnerHash`) and no owner exists yet. Reads only; it never uses the link up. */
  const linkOpen = async (token: string | null | undefined): Promise<boolean> =>
    !!token && !!options.firstOwnerHash && await sha256(token) === options.firstOwnerHash.toLowerCase() && !await hasOwner();
  const tokenOf = (context?: { headers?: Headers; request?: Request } | null) => context?.request?.headers?.get(FIRST_OWNER) ?? context?.headers?.get?.(FIRST_OWNER) ?? null;
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
      // By invitation only: an invited address, the holder of the first-owner link, or a Studio owner back from Studio. Through Google, the
      // invited address counts only when Google says it is verified: an unverified one could be anyone's.
      before: async (user: { email: string; emailVerified?: boolean }, context?: { params?: Record<string, string>; headers?: Headers; request?: Request } | null) => {
        const email = normalEmail(user.email), provider = context?.params?.['id'] ?? context?.params?.['providerId'];
        if (provider === 'google' && user.emailVerified !== true) throw new APIError('FORBIDDEN', { code: 'NOT_INVITED', message: say('NOT_INVITED', 'en') ?? 'NOT_INVITED' });
        if (await invitationOf(email) || await linkOpen(tokenOf(context))) return;
        if (provider === STUDIO && pending.studioOwners.delete(email)) return;
        throw new APIError('FORBIDDEN', { code: 'NOT_INVITED', message: say('NOT_INVITED', 'en') ?? 'NOT_INVITED' });
      },
      after: async (user: { email: string }, context?: { headers?: Headers; request?: Request } | null) => {
        const email = normalEmail(user.email);
        if (!await linkOpen(tokenOf(context))) return;
        await (await adapter()).create({ model: 'invitation', data: { email, role: 'owner', invitedBy: 'first-owner link', createdAt: new Date() } });
      },
    } } },
    telemetry: { enabled: false },
    advanced: {
      // Better Auth's own runtime schema check reads the schema again for each adapter it sees (13 reads a request on D1); the migration below owns it.
      database: { validateSchema: false },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
      backgroundTasks: { handler: (promise: Promise<unknown>) => { if (live.waitUntil) live.waitUntil(promise); else promise.catch(() => undefined); } },
    },
  };
  const auth = betterAuth(settings as never);
  const ready = () => migrateOnce(options.database, () => getMigrations(settings as never).then((m) => m.runMigrations()));
  return { auth, origin, ready, adapter, roleOf, hasOwner, linkOpen, pending, link };
}

export type Auth = ReturnType<typeof buildAuth>;
