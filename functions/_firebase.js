// Verify a Firebase ID token (RS256 JWT) and look up the user's approval status in Firestore.
const enc = new TextEncoder();
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { at: 0, keys: null };

async function getKeys(env) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const r = await fetch(env.JWKS_URL || JWKS);
  if (!r.ok) throw new Error('jwks');
  jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  return jwksCache.keys;
}

export async function verifyIdToken(token, env) {
  const pid = env.FIREBASE_PROJECT_ID;
  if (!pid || typeof token !== 'string' || token.length > 6000) throw new Error('config/token');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('format');
  const header = JSON.parse(new TextDecoder().decode(unb64u(h)));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('alg');
  const jwk = (await getKeys(env)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('kid');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s), enc.encode(h + '.' + p))) throw new Error('signature');
  const c = JSON.parse(new TextDecoder().decode(unb64u(p)));
  const now = Date.now() / 1000;
  if (c.aud !== pid || c.iss !== 'https://securetoken.google.com/' + pid) throw new Error('aud/iss');
  if (!(c.exp > now) || c.iat > now + 120 || !c.sub) throw new Error('time/sub');
  return c;   // { sub (uid), email, email_verified, name, ... }
}

// users/{uid}.status is 'pending' | 'approved' | 'denied'; Firestore rules let a user read only their own document.
export async function userStatus(uid, idToken, env) {
  const base = env.FIRESTORE_URL || 'https://firestore.googleapis.com';
  const r = await fetch(`${base}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: 'Bearer ' + idToken } });
  if (r.status === 404 || r.status === 403) return 'none';
  if (!r.ok) throw new Error('firestore ' + r.status);
  return (await r.json()).fields?.status?.stringValue || 'none';
}
