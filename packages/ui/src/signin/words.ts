// The sentences a person reads when sign-in refuses something, in English and French. Better Auth answers with a code; these replace its
// English message by the person's language (the page sends `x-boring-lang`, else the browser's Accept-Language decides).

export type Lang = 'en' | 'fr';

const WORDS: Record<string, Record<Lang, string>> = {
  INVALID_EMAIL_OR_PASSWORD: { en: 'Wrong e-mail or password.', fr: 'E-mail ou mot de passe incorrect.' },
  INVALID_EMAIL: { en: 'This e-mail address is not valid.', fr: 'Cette adresse e-mail n’est pas valide.' },
  PASSWORD_TOO_SHORT: { en: 'The password needs at least 8 characters.', fr: 'Le mot de passe doit faire au moins 8 caractères.' },
  PASSWORD_TOO_LONG: { en: 'The password can have at most 128 characters.', fr: 'Le mot de passe doit faire au plus 128 caractères.' },
  USER_ALREADY_EXISTS: { en: 'An account already exists with this address. Sign in instead.', fr: 'Un compte existe déjà avec cette adresse. Connectez-vous.' },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: { en: 'An account already exists with this address. Sign in instead.', fr: 'Un compte existe déjà avec cette adresse. Connectez-vous.' },
  PROVIDER_NOT_FOUND: { en: 'This way of signing in is not turned on.', fr: 'Ce mode de connexion n’est pas activé.' },
  INVALID_ORIGIN: { en: 'Open the app at its usual address to sign in.', fr: 'Ouvrez l’app à son adresse habituelle pour vous connecter.' },
  MISSING_OR_NULL_ORIGIN: { en: 'Open the app at its usual address to sign in.', fr: 'Ouvrez l’app à son adresse habituelle pour vous connecter.' },
  NOT_INVITED: { en: 'This address has no invitation. Ask the app’s owner to invite you.', fr: 'Cette adresse n’a pas d’invitation. Demandez au propriétaire de l’app de vous inviter.' },
  NOT_ON_THE_LIST: { en: 'Your access to this app was removed. Ask its owner.', fr: 'Votre accès à cette app a été retiré. Demandez à son propriétaire.' },
  OWNERS_ONLY: { en: 'Only the app’s owners can do this.', fr: 'Seuls les propriétaires de l’app peuvent faire cela.' },
  TOO_MANY_REQUESTS: { en: 'Too many tries for now. Try again later.', fr: 'Trop d’essais pour l’instant. Réessayez plus tard.' },
  SIGN_IN_FIRST: { en: 'Sign in first.', fr: 'Connectez-vous d’abord.' },
  BAD_EMAIL: { en: 'This e-mail address is not valid.', fr: 'Cette adresse e-mail n’est pas valide.' },
  MCP_TOKEN: { en: 'Connect your assistant to this app: an access token is needed.', fr: 'Connectez votre assistant à cette app : un jeton d’accès est requis.' },
};

/** The person's language: the page's own choice first, then the browser's. */
export function langOf(request: Request): Lang {
  const chosen = request.headers.get('x-boring-lang');
  if (chosen === 'fr' || chosen === 'en') return chosen;
  return /^\s*fr\b/i.test(request.headers.get('accept-language') ?? '') ? 'fr' : 'en';
}

/** The sentence for a refusal code, or undefined when the code has none (Better Auth's own message then stays). */
export const say = (code: string, lang: Lang): string | undefined => WORDS[code]?.[lang];

/** Better Auth's JSON refusals with the sentence in the person's language; a 429 becomes a sentence too, never a bare status. */
export async function inWords(response: Response, lang: Lang): Promise<Response> {
  if (response.status === 429) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    return new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS', message: say('TOO_MANY_REQUESTS', lang) }), { status: 429, headers });
  }
  if (response.status < 400 || !response.headers.get('content-type')?.includes('application/json')) return response;
  const body = await response.clone().json().catch(() => undefined) as { code?: string } | undefined;
  const message = body?.code ? say(body.code, lang) : undefined;
  if (!message) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({ ...body, message }), { status: response.status, headers });
}

/** A refusal of ours, as JSON with its code and sentence. */
export const refuse = (code: string, status: number, lang: Lang, headers?: Record<string, string>): Response =>
  Response.json({ code, message: say(code, lang) ?? code }, { status, ...(headers ? { headers } : {}) });
