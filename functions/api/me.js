import { readSession } from '../_session.js';
export async function onRequestGet({ request, env }) {
  const s = await readSession(request, env);
  return new Response(JSON.stringify(s ? { email: s.email, admin: s.admin } : { email: null }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
