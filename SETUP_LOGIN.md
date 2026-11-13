# Private sign-in (Google) – setup

The app is open to the public except the hymn database and the library (`hymnal.db`, `staff.db`), which are only sent to signed-in people whose Google email is on your list.
No card and no app password are needed.

## 1. Google: create a sign-in client ID (once, ~5 min, desktop browser)
1. console.cloud.google.com → create a project (any name, e.g. "Hymnal").
2. **APIs & Services → OAuth consent screen**: User type **External**, fill app name + your email, save.
   Under **Audience / Test users** add the Gmail addresses allowed to sign in (up to 100). Leave it in *Testing*.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
   **Authorized JavaScript origins**: `https://preacher-s-companion.pages.dev` (add `http://localhost:8788` only if you test locally).
4. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 2. Put the Client ID in the app
Edit `app/config.js`: `window.PC_CONFIG = { googleClientId: 'PASTE-CLIENT-ID-HERE' };` (it is public, safe to commit).

## 3. Cloudflare variables (Pages project → Settings → Variables and Secrets → Production)
| name | type | value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | text | same Client ID |
| `ALLOWED_EMAILS` | text | `you@gmail.com, friend@gmail.com` (comma separated) |
| `SESSION_SECRET` | **secret** | any random string of 32+ characters (e.g. from a password manager) |
| `REQUIRE_LOGIN` | text | `1` — turns the sign-in requirement ON. Leave it unset and the site stays open, as before. |

Then redeploy. To add or remove a person later, edit `ALLOWED_EMAILS` (removal takes effect immediately for new requests;
a copy already saved on that person's phone stays there).

## How it works
`functions/_middleware.js` answers `401` for `/hymnal.db` unless the request carries a valid signed cookie.
`functions/api/login.js` verifies the Google ID token (audience, issuer, verified email, expiry), checks the allow-list and sets a 30-day
HttpOnly cookie. After the first successful download the database is also kept on the device so the app works offline.
