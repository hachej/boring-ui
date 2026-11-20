import { signIn } from "@hachej/boring-ui-kit/signin";

export type SignInEnv = {
  DB: D1Database; BETTER_AUTH_SECRET: string;
  FIRST_OWNER_HASH?: string; STUDIO_ORIGIN?: string; STUDIO_APP?: string; STUDIO_CLIENT?: string;
};

/** The routes the Worker runs itself: the kit's sign-in, then everything else for a signed-in person only — a session on the page,
 *  an assistant's token on /mcp. `pass` sends the request on (to the app's unit). */
export async function gate(request: Request, env: SignInEnv, pass: () => Promise<Response>, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const url = new URL(request.url);
  const auth = signIn({
    database: env.DB, secret: env.BETTER_AUTH_SECRET, origin: url.origin, appName: "List", firstOwnerHash: env.FIRST_OWNER_HASH, waitUntil,
    ...(env.STUDIO_ORIGIN && env.STUDIO_CLIENT ? { studio: { origin: env.STUDIO_ORIGIN, app: env.STUDIO_APP ?? "boring-studio-template", clientId: env.STUDIO_CLIENT } } : {}),
  });
  const answered = await auth.handle(request);
  if (answered) return answered;
  const person = url.pathname === "/mcp" ? await auth.mcpPerson(request) : await auth.personOf(request);
  if (!person) return url.pathname === "/mcp" ? auth.mcpRefusal(request) : Response.json({ refused: "sign in first" }, { status: 401 });
  return pass();
}
