// Better Auth the way alchemy.run/domain/better-auth shows it: e-mail and password, Better Auth's `bearer` plugin (an outside MCP client signs
// its calls with the person's session token) and its OAuth provider plugin (an agent of another app gets, after the person agreed once, a token
// for that person at this app's MCP door). Mail, verification and reset are not here.
import { BetterAuth, type BetterAuthInstance, type BetterAuthProps } from "@alchemy.run/better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { bearer } from "better-auth/plugins";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export const SCOPES = ["openid", "offline_access"];
const options = {
  basePath: "/api/auth", emailAndPassword: { enabled: true },
  // the address is read from the request, for these hosts only (the issuer and every redirect of the OAuth provider need it)
  baseURL: { allowedHosts: ["localhost:*", "127.0.0.1:*", "*.workers.dev"], protocol: "auto" as const },
  plugins: [bearer(), oauthProvider({
    loginPage: "/", consentPage: "/consent", scopes: SCOPES, disableJwtPlugin: true,
    allowDynamicClientRegistration: true, allowUnauthenticatedClientRegistration: true,
    accessTokenExpiresIn: 3600, silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
  } as never)],
} satisfies BetterAuthProps;
export class Auth extends Context.Service<Auth, BetterAuthInstance<typeof options>>()("App/Auth") {}
export const AuthLive = Layer.effect(Auth, BetterAuth(options as never) as never);
