// POST { credential } = Google ID token from "Sign in with Google". Sets the session cookie if the email is allowed.
import { makeSession, allowed, cookieHeader, MAX_AGE } from '../_session.js';

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'bad origin' }, 403);
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET || env.SESSION_SECRET.length < 24) return json({ error: 'server not configured' }, 500);
  let credential;
  try { ({ credential } = await request.json()); } catch { return json({ error: 'bad request' }, 400); }
  if (typeof credential !== 'string' || credential.length > 5000) return json({ error: 'bad request' }, 400);

  const base = env.TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
  let info;
  try {
    const r = await fetch(`${base}?id_token=${encodeURIComponent(credential)}`);
    if (!r.ok) return json({ error: 'invalid sign-in' }, 401);
    info = await r.json();
  } catch { return json({ error: 'could not verify sign-in' }, 502); }

  const email = String(info.email || '').toLowerCase();
  const ok = info.aud === env.GOOGLE_CLIENT_ID && String(info.email_verified) === 'true' &&
    ['accounts.google.com', 'https://accounts.google.com'].includes(info.iss) && Number(info.exp) > Date.now() / 1000;
  if (!ok || !email) return json({ error: 'invalid sign-in' }, 401);
  if (!allowed(env).includes(email)) return json({ error: 'not on the approved list', email }, 403);

  return json({ ok: true, email }, 200, { 'Set-Cookie': cookieHeader(await makeSession(env, email), MAX_AGE) });
}
