// The bridge between Studio and the apps it links. Studio's owners are each linked app's owners, proven, never matched by e-mail alone.
//
// - Studio signs its owner list (Better Auth's jwt plugin, its own keys): `/api/signin/owners` answers a 5-minute token naming each owner's
//   Studio id (`sub`). An app checks it against Studio's public keys (jwks), caches it a few minutes, and reads no other source of owners.
// - An owner proves who they are by a round trip through Studio (OIDC, Better Auth's oauthProvider on Studio and genericOAuth in the app,
//   the client Studio registered when it linked the app). The app stores Studio's `sub` on the person's `studio` account.
// - Owner in the app = a `studio` account whose `sub` is on Studio's current signed list. A direct sign-up with an owner's e-mail has no
//   `studio` account, so no role; a person removed in Studio drops off the list, so loses the role within the cache's few minutes.
import { createLocalJWKSet, jwtVerify } from 'jose';

export const STUDIO = 'studio';
export const STUDIO_SCOPES = ['openid', 'profile', 'email'];
/** The audience of Studio's owner list. */
export const OWNERS_AUDIENCE = 'boring-studio-owners';
const LIST_TTL_MS = 3 * 60 * 1000;

export interface StudioClientOptions {
  /** Studio's origin, such as `https://studio.example`. */
  readonly origin: string;
  /** The app's name in Studio (its slug): the « Studio » entry opens this app's page there. */
  readonly app: string;
  /** The client id Studio gave this app when it linked it (`linkApp`). */
  readonly clientId: string;
  /** How this Worker reaches Studio: a service binding's fetch, or the global fetch (needs `global_fetch_strictly_public` on workers.dev). */
  readonly fetch?: typeof fetch;
  /** How long the app keeps Studio's owner list and keys before asking again: 3 minutes by default. */
  readonly ownersTtlMs?: number | undefined;
}

export interface Owner { readonly sub: string }

/** The redirect address of an app's Studio round trip. */
export const studioCallback = (appOrigin: string) => `${new URL(appOrigin).origin}/api/auth/callback/${STUDIO}`;

/** Studio's keys and owner list, as one app sees them: verified, cached a few minutes per isolate. */
export function studioLink(studio: StudioClientOptions) {
  const get = studio.fetch ?? fetch;
  const issuer = `${studio.origin}/api/auth`;
  const ttl = studio.ownersTtlMs ?? LIST_TTL_MS;
  let keys: { at: number; set: ReturnType<typeof createLocalJWKSet> } | undefined;
  let owners: { at: number; subs: Set<string> } | undefined;
  const keySet = async () => {
    if (!keys || Date.now() - keys.at > LIST_TTL_MS) keys = { at: Date.now(), set: createLocalJWKSet(await (await get(`${issuer}/jwks`)).json() as never) };
    return keys.set;
  };
  /** The Studio ids of Studio's owners now; empty when Studio cannot be reached or its token does not check (no owner, never a guess). */
  const ownerSubs = async (): Promise<Set<string>> => {
    if (owners && Date.now() - owners.at < ttl) return owners.subs;
    try {
      const { token } = await (await get(`${studio.origin}/api/signin/owners`)).json() as { token: string };
      const { payload } = await jwtVerify(token, await keySet(), { issuer, audience: OWNERS_AUDIENCE });
      const list = Array.isArray(payload['owners']) ? payload['owners'] as Owner[] : [];
      owners = { at: Date.now(), subs: new Set(list.map((o) => o.sub)) };
      return owners.subs;
    } catch { return new Set(); }
  };
  /** Better Auth's genericOAuth entry for the round trip; `onSignIn` hears who came back and whether Studio lists them as an owner. */
  const provider = (onSignIn: (email: string, owner: boolean) => void) => ({
    providerId: STUDIO,
    name: 'Studio',
    clientId: studio.clientId,
    authorizationUrl: `${issuer}/oauth2/authorize`,
    tokenUrl: `${issuer}/oauth2/token`,
    scopes: STUDIO_SCOPES,
    pkce: true,
    overrideUserInfo: true,
    getToken: async ({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string | undefined }) => {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectURI, client_id: studio.clientId });
      if (codeVerifier) body.set('code_verifier', codeVerifier);
      const r = await get(`${issuer}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const t = await r.json() as { access_token?: string; id_token?: string; expires_in?: number; scope?: string };
      if (!r.ok || !t.access_token) throw new Error(`Studio refused the code (${r.status})`);
      return { tokenType: 'Bearer', accessToken: t.access_token, ...(t.id_token ? { idToken: t.id_token } : {}),
        ...(t.expires_in ? { accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000) } : {}), scopes: (t.scope ?? '').split(' ').filter(Boolean) };
    },
    // The ID token, checked against Studio's keys, its issuer and this app's client id, says who the person is (`sub`); Studio's userinfo,
    // asked with the access token of the same exchange, gives their e-mail and name, and must name the same `sub`.
    getUserInfo: async (tokens: { idToken?: string | undefined; accessToken?: string | undefined }) => {
      if (!tokens.idToken || !tokens.accessToken) return null;
      const claims = await jwtVerify(tokens.idToken, await keySet(), { issuer, audience: studio.clientId }).then((r) => r.payload, () => undefined);
      if (!claims?.sub) return null;
      const info = await (await get(`${issuer}/oauth2/userinfo`, { headers: { authorization: `Bearer ${tokens.accessToken}` } })).json().catch(() => ({})) as Record<string, unknown>;
      if (info['sub'] !== claims.sub || typeof info['email'] !== 'string') return null;
      onSignIn(info['email'].toLowerCase(), (await ownerSubs()).has(claims.sub));
      return { id: claims.sub, sub: claims.sub, email: info['email'], emailVerified: info['email_verified'] === true,
        name: typeof info['name'] === 'string' && info['name'] ? info['name'] : info['email'] };
    },
  });
  return { ownerSubs, provider, entry: `${studio.origin}/?app=${encodeURIComponent(studio.app)}` };
}
