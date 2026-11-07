// Signed session cookie: base64url(JSON{email,exp}).base64url(HMAC-SHA256)
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const COOKIE = 'pc_session';
export const MAX_AGE = 60 * 60 * 24 * 30;   // 30 days

const key = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);

export async function makeSession(env, email) {
  const payload = b64u(enc.encode(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + MAX_AGE })));
  const sig = await crypto.subtle.sign('HMAC', await key(env.SESSION_SECRET, ['sign']), enc.encode(payload));
  return `${payload}.${b64u(sig)}`;
}

export async function readSession(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 24) return null;      // fail closed
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(env.SESSION_SECRET, ['verify']), unb64u(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    // an email removed from the allow-list loses access at once
    if (!allowed(env).includes(String(data.email).toLowerCase())) return null;
    return data;
  } catch { return null; }
}

export const allowed = env => String(env.ALLOWED_EMAILS || '').split(/[,\s;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

export const cookieHeader = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
