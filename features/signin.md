# Sign-in (signin)

An app's sign-in on Better Auth, built directly, with no host around it: the Worker part is the kit subpath `@hachej/boring-ui-kit/signin` (Better Auth, `better-auth`, `@better-auth/core`, `@better-auth/oauth-provider` and `jose` are optional peer dependencies, so an app without sign-in pulls none of them), and the pages are the registry block `sign-in`. One object, `signIn(options)`, answers the sign-in routes of the app's Worker and says who is asking.

## Sub-features

- `signin-invitation` e-mail and password by invitation only: an address not on the app's invitation list is refused with `NOT_INVITED`, in the person's language (`x-boring-lang`, else Accept-Language). The list is a Better Auth plugin table, migrated with Better Auth's own on the first request. `/api/signin/people` (owners only) lists, invites and removes; a removed person loses access at their next request. `packages/ui/src/signin/auth.ts`, `packages/ui/src/signin/index.ts`.
- `signin-first-owner` the first owner proves a one-use link, never an e-mail: the stack holds the SHA-256 of the link's token (`firstOwnerHash`), a sign-up carrying the token (`x-boring-first-owner`, from `/sign-in?first-owner=<token>`) while no owner exists becomes the owner; once an owner exists the link is dead.
- `signin-limits` Better Auth's own rate limits, kept in the app's database (every isolate counts the same), with sign-ups per hour per address (20 by default); the person's address is `cf-connecting-ip`. A 429 comes back as a sentence, never a bare status. `packages/ui/src/signin/words.ts`.
- `signin-google` « Continue with Google » when the app has its client (`google: { clientId, clientSecret }`; `/api/signin/options` says `google: true`, the page shows the button): Better Auth's own Google provider, its redirect `<origin>/api/auth/callback/google`. Still by invitation: a Google account gets an account only when its address is invited and Google says it is verified (`email_verified`). The first owner comes by the one-use link, with e-mail and password.
- `signin-mcp-oauth` the OAuth provider an assistant signs in to `/mcp` with: discovery (`/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`), dynamic registration (a client whose callbacks are all on loopback is native), PKCE, the « Allow » page; `mcpPerson` reads a bearer token issued for `<origin>/mcp`, `mcpRefusal` is the 401 that sends the assistant to sign in.
- `signin-studio-bridge` Studio's owners are each linked app's owners, proven: Studio signs its owner list by Studio id (`/api/signin/owners`, 5-minute token, its own keys), an owner links an app (`/api/signin/links`, a public PKCE client with no consent screen), and the app's `/api/signin/studio` does the round trip that stores the person's Studio id. Owner in the app = a Studio account whose id is on the current signed list; a direct sign-up with an owner's address never is one. `packages/ui/src/signin/studio.ts`.
- `signin-pages` the registry block `sign-in`: `SignInPage`, `ConsentPage`, `PeopleList`, `useSignedIn` and `studioNavItem` (the « Studio » entry of an app's left pane, owners only), English and French, labels overridable. `registry/sign-in/`.

## How to get to it (user POV)

- A person opens the app and sees the sign-in page; invited, they create their account; the owner sees « People » to invite others and, in an app linked to Studio, « Studio » to open the app's page there.
- In Claude Code, `claude mcp add --transport http <app> <origin>/mcp`, then the browser opens the app's sign-in and « Allow ».

## Driving it with the example journeys

Preconditions: `npm run build`; no network and no key needed (two Worker instances, a Studio and an app, on in-memory `node:sqlite`).

- **Google.** `signin-google`: `node --test test/packages/signin-google.test.mjs` (a stand-in Google answers the code exchange and its keys in the process: the button only with a client; an uninvited address and an invited one Google does not verify are refused; an invited, verified one gets in as a member).
- **Invitations and the first owner.** `signin-invitation`, `signin-first-owner`, `signin-limits`: `node --test test/packages/signin.test.mjs` (the first test: a stranger refused in French, a guessed and a used link refused, an invited member, a removal).
- **Assistant.** `signin-mcp-oauth`: the second test registers a loopback client, runs the authorization with PKCE and opens `/mcp` with the token.
- **Bridge.** `signin-studio-bridge`, `signin-pages` (the `studio` entry in `/api/signin/me`): the third test links an app, proves a Studio owner through the round trip, keeps a direct sign-up with an owner's address a member, refuses a Studio member, and drops a removed owner.

## Gotchas

- Better Auth needs the request's origin: on Workers make one `signIn` per request with `new URL(request.url).origin`. Better Auth's async local storage is per process: two instances in one Node process (tests) must call each other outside it.
- On workers.dev an app's Worker cannot fetch Studio's: give the app's Worker `global_fetch_strictly_public` (or pass a service binding's `fetch` in `studio.fetch`).
- An ID token of Better Auth's provider carries no e-mail: the round trip reads the person's e-mail from Studio's userinfo and checks it names the same Studio id.
- A Studio owner whose address already has a direct account in the app is refused (`account_not_linked`): Studio does not verify e-mail addresses, so the bridge never links by address.
