# Private access with Firebase sign-in (approve / deny)

How it works: people sign in with Google. If they are not approved yet, their email is added to a list of **requests**.
The administrator (**sjprempeh@gmail.com**) always has access and sees an **Admin** tab with **Approve / Deny** buttons.
The hymn and library databases are only sent to approved people. Everything below is free (Firebase *Spark* plan, no card).

## 1. Firebase project (desktop browser, ~10 min)
1. console.firebase.google.com → **Add project** (name e.g. "preachers-companion"; turn Google Analytics off).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** (choose a support email) → Save.
   Then **Authentication → Settings → Authorized domains → Add domain**: `preacher-s-companion.pages.dev`.
3. **Build → Firestore Database → Create database** → *Production mode* → pick a location.
   Open the **Rules** tab, paste the contents of `firestore.rules` from this repo, **Publish**.
4. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` values
   (`apiKey`, `authDomain`, `projectId`, `appId`) into `app/config.js` (these are public identifiers, safe to commit).

## 2. Cloudflare Pages → Settings → Variables and Secrets (Production)
| name | type | value |
|---|---|---|
| `FIREBASE_PROJECT_ID` | text | your `projectId` |
| `SESSION_SECRET` | **secret** | any random string of 32+ characters |
| `ADMIN_EMAIL` | text | optional, defaults to `sjprempeh@gmail.com` |
| `REQUIRE_LOGIN` | text | `1` — turns the requirement ON (add this **last**; leave unset and the site stays open) |

Redeploy after saving.

## Using it
* A new person opens the app → **Sign in with Google** → "Request sent, waiting for approval".
* The admin opens the app, signs in, taps **Admin** → **Approve** or **Deny** (and later **Remove access**).
* The person taps **Check again** and is in. Approved phones keep working offline.

## Good to know
* Approval is checked when a person signs in; a session lasts 7 days. After **Remove access**, that person is refused at their next sign-in
  (and their offline copy is deleted the next time their phone is online and asks for the data).
* The admin email is also written in `firestore.rules` (line with `sjprempeh@gmail.com`) — change both if the admin changes.
* A new email is only a request; it cannot read anything until approved. Firestore rules stop people from approving themselves.
