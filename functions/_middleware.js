// Everything in app/ is public except the databases (hymns + library), which need a valid session cookie once REQUIRE_LOGIN=1.
import { readSession } from './_session.js';

export async function onRequest(ctx) {
  const path = new URL(ctx.request.url).pathname.toLowerCase().replace(/\/+$/, '');
  // Sign-in is opt-in: it only applies once REQUIRE_LOGIN=1 is set in Cloudflare (see SETUP_FIREBASE.md)
  if (ctx.env.REQUIRE_LOGIN === '1' && (path === '/hymnal.db' || path === '/staff.db')) {
    const s = await readSession(ctx.request, ctx.env);
    if (!s) return new Response('Sign in required', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    const r = await ctx.next();
    const h = new Headers(r.headers);
    h.set('Cache-Control', 'private, no-cache');
    return new Response(r.body, { status: r.status, headers: h });
  }
  return ctx.next();
}
