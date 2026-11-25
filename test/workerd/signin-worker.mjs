// The sign-in of an app on Cloudflare, as an app writes it: the kit's `signIn` made inside `fetch` over the D1 binding. `/__migrate` plays the deploy's
// migration step (the kit's shipped SQL on the binding).
import { applySignInMigration, signIn } from '@hachej/boring-ui-kit/signin';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__migrate') { await applySignInMigration(env.DB); return new Response('migrated'); }
    const app = signIn({ database: env.DB, secret: env.SECRET, origin: url.origin, appName: 'Workerd test', firstOwnerHash: env.FIRST_OWNER_HASH,
      signUpsPerHour: 100000, waitUntil: (promise) => ctx.waitUntil(promise) });
    return (await app.handle(request)) ?? new Response('page');
  },
};
