import { cookieHeader } from '../_session.js';
export async function onRequestPost() {
  return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader('', 0), 'Cache-Control': 'no-store' } });
}
