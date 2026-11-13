// POST { idToken } (Firebase ID token). Sets the session cookie only if the user is the admin or has been approved.
import { verifyIdToken, userStatus } from '../_firebase.js';
import { makeSession, cookieHeader, MAX_AGE } from '../_session.js';

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'bad origin' }, 403);
  if (!env.FIREBASE_PROJECT_ID || !env.SESSION_SECRET || env.SESSION_SECRET.length < 24) return json({ error: 'server not configured' }, 500);
  let idToken;
  try { ({ idToken } = await request.json()); } catch { return json({ error: 'bad request' }, 400); }
  let claims;
  try { claims = await verifyIdToken(idToken, env); } catch { return json({ error: 'invalid sign-in' }, 401); }

  const email = String(claims.email || '').toLowerCase();
  if (!email || claims.email_verified !== true) return json({ error: 'email not verified' }, 401);
  const admin = email === String(env.ADMIN_EMAIL || 'sjprempeh@gmail.com').toLowerCase();
  let status = admin ? 'approved' : 'none';
  if (!admin) { try { status = await userStatus(claims.sub, idToken, env); } catch { return json({ error: 'could not check approval' }, 502); } }
  if (status !== 'approved') return json({ status, email }, 403);
  return json({ status: 'approved', email, admin }, 200, { 'Set-Cookie': cookieHeader(await makeSession(env, { uid: claims.sub, email, admin }), MAX_AGE) });
}
