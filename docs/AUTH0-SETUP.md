# Setting up Auth0 for Casework

This walks through configuring an Auth0 tenant so this app can authenticate real users and
exchange their identity for a Vectros API credential. It assumes you already have (or are
willing to create) a free Auth0 account.

> **Auth0's dashboard changes over time.** The screen names, tab layout, and field labels below
> are accurate as of when this was written, but Auth0 restyles its dashboard periodically. If a
> screen doesn't match what's described here, look for the same *concept* — "callback URLs",
> "authorize this application for an API" — under whatever the current UI calls it, and consult
> [Auth0's own docs](https://auth0.com/docs) if you get stuck.

## 1. Create the application

**Applications → Applications → Create Application.** Choose **Single Page Application**. This
app authenticates entirely from the browser via Auth0's hosted login (Universal Login) — no
server-side client secret is involved.

Give it a name (e.g. "Casework"). Note the **Domain** and **Client ID** shown on its Settings
page — you'll need both shortly.

## 2. Create an API

**Applications → APIs → Create API.** This represents the resource your Vectros deployment
protects. Give it:

- A **Name** (e.g. "Casework")
- An **Identifier** — this is the *audience* value. It doesn't have to be a real URL; a short
  slug like `casework` works fine. Whatever you choose, you'll use the exact same string as the
  `auth0Audience` input when applying the Vectros blueprint (step 5).

If you want separate test and production environments (recommended — it means you can safely
throw away test data without touching anything real), create **two** APIs, e.g. identifiers
`casework-test` and `casework-prod`, both under the same application from step 1.

## 3. Authorize the application for the API — the step that's easy to miss

This is a **separate, explicit step** from creating the application and the API — Auth0 does not
authorize them for each other automatically, and skipping it produces a login redirect that
fails with an error resembling:

```
invalid_request: Client "<your client id>" is not authorized to access resource server "<your API identifier>".
```

Go to **Applications → Applications → [your application]** → its own **APIs** tab (this is
different from the top-level "Applications → APIs" list — you want the tab *inside* the specific
application). Find the row for the API you created in step 2, and toggle on **User-delegated
Access** (this app signs users in via Authorization Code + PKCE, a user-delegated flow — leave
**Client Access** off, since that's for machine-to-machine/client-credentials flows this app
doesn't use).

The permission-count shown next to the toggle (e.g. "0 / 0 permissions granted") is unrelated to
whether the toggle itself is on — an API with no defined scopes will always show `0 / 0` even
when correctly authorized. Don't use that count as a signal; re-test the actual login flow
instead (step 6).

## 3a. Skip the consent screen on repeat logins

Without this, Auth0 re-prompts "Authorize App?" on **every** login, not just the first — annoying
for real users of a first-party app like this one (there's nothing third-party about a user
authorizing your own SPA to call your own API).

Go to **Applications → APIs → [your API] → Settings → Access Settings** and toggle on **Allow
Skipping User Consent**. This is a per-API setting — if you created separate test/prod APIs (step
2), toggle it on **both**, not just the one you're actively testing against.

## 4. Set the application's URLs

Back in **Applications → Applications → [your application] → Settings**, fill in:

- **Allowed Callback URLs** — where Auth0 redirects back after login. For local development this
  is `https://localhost:3003/callback` (the app's default dev port — see **4a** below for why this
  is `https://localhost`, not `http://127.0.0.1`, despite that being Vite's more common default).
  Add your production URL here too once you have one, comma-separated.
- **Allowed Logout URLs** — the origin to return to after sign-out, e.g. `https://localhost:3003`.
  Same rule as Callback URLs: add your production origin here too, comma-separated, once you have
  one — a missing entry here produces Auth0's generic error page on logout (not a redirect
  failure, so it's easy to misdiagnose as something else).
- **Allowed Web Origins** and **Allowed Origins (CORS)** — the same origin, `https://localhost:3003`.
  These matter for session-refresh and token-endpoint calls the Auth0 SDK makes from the browser.

Leave **Application Login URI** empty — it's for a different feature (third-party-initiated
login) this app doesn't use.

## 4a. Local dev needs `https://localhost`, not `http://127.0.0.1` — a real invite send will 400 otherwise

**Easy to get partway through local setup without hitting this** — sign-in itself works fine over
plain `http://127.0.0.1:3003`, and everything up through browsing the app as an existing member
looks normal. It only bites the first time you actually **send** an invite (`Team → + Invite`).

The platform's invite endpoint unconditionally
rejects an `acceptUrl` whose scheme isn't `https://` or whose host is an IP literal
(`127.0.0.1`), for **every** credential — this is a deliberate, permanent anti-open-redirect /
anti-SSRF rule, not a bug to work around. `inviteMember.ts` builds `acceptUrl` from
`window.location.origin` at call time, so whatever origin the dev server actually runs on is what
gets sent — meaning the dev server itself needs to be on an origin that satisfies this rule.
`https://localhost:3003` does (`localhost` is a hostname, not an IP literal); `http://127.0.0.1:3003`
never will, no matter what else you configure.

**Set it up once, with [`mkcert`](https://github.com/FiloSottile/mkcert)** (installs a local CA
into your OS/browser trust stores, so the resulting cert is trusted with zero warnings — a plain
`openssl`-generated self-signed cert works too but every browser will show a security warning on
every visit):

```bash
# Install mkcert (macOS: brew install mkcert; Windows: choco install mkcert; Linux: see mkcert's README)
mkcert -install                                    # one-time — trusts mkcert's local CA
cd ui/casework-spa                                 # or wherever this app lives in your repo
mkdir -p .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost-cert.pem localhost 127.0.0.1 ::1
```

`vite.config.ts` picks this up automatically if present (`.cert/` is gitignored — regenerate it
per clone/machine) and falls back to plain `http://` if it's absent, so `npm run dev` still runs
without it — you just can't send a real invite until you've done this. `npm run dev` then serves
on `https://localhost:3003` instead of `http://127.0.0.1:3003`; update the Auth0 URLs in step 4
above to match before your next login.

## 5. Register the issuer with your Vectros deployment

Apply this app's blueprint ([`blueprint/casework.blueprint.yaml`](../blueprint/casework.blueprint.yaml)) with your Auth0 values as inputs, run from this app's own directory:

```bash
vectros bootstrap --blueprint blueprint/casework.blueprint.yaml --tenant test \
  --set companyName="Your Company" \
  --set auth0Domain=<your Auth0 domain> \
  --set auth0Audience=<the API identifier from step 2>
```

This tells Vectros to trust **access tokens** issued by your Auth0 tenant for the given audience,
and is what the token-exchange endpoint checks against when this app trades an Auth0 session for
a Vectros API credential. This app presents Auth0's access token, not its ID token — the two carry
different `aud` claims (the access token's `aud` is the API identifier from step 2; the ID token's
is your Client ID), and only the access token's `aud` matches what you register here. If you're
adapting this flow for your own app, sending the ID token instead is a real, easy mistake to make
and produces an opaque token-exchange rejection with no indication of which token was the problem.

## 5a. Getting the invitee's email — handled automatically, no action needed

Step 5 above deliberately has this app present Auth0's **access token**, not its ID token — but
Auth0 access tokens don't carry an `email` claim by default; only ID tokens do. When someone
accepts an invite, the platform reads the invitee's email off the presented token to bind their
first-login identity, so a missing `email` would otherwise break every first login with a silent
failure and nothing to find in the logs.

**This app's blueprint already handles it for you.** Its issuer registration sets a
`userinfoUri` pointing at your Auth0 domain's standard `/userinfo` endpoint — when the presented
access token doesn't carry `email` directly (the normal case), the platform falls back to calling
that endpoint and reading `email` from its response instead. This is set automatically by
`vectros bootstrap` in step 5 above; there is nothing to configure here for a standard Auth0
tenant.

**If you're adapting this flow for a different OIDC provider** whose access tokens likewise omit
`email`, and whose IdP does NOT implement a standard `/userinfo` endpoint, you'll need your own
equivalent of a post-login hook that stamps a custom `email` claim onto the access token directly,
then point your issuer registration's `emailClaim` at that custom claim's name instead of the
default bare `email`. Consult your IdP's documentation for the equivalent of Auth0's Actions
(Post Login hooks) if you need this path — it should only be necessary when `userinfoUri` isn't an
option.

## 6. Configure the app and test it

Copy `.env.example` to `.env.local` and fill in:

```
VITE_AUTH0_DOMAIN=<your Auth0 domain>
VITE_AUTH0_CLIENT_ID=<your Client ID, from step 1>
VITE_AUTH0_AUDIENCE=<the API identifier from step 2>
VITE_VECTROS_EXCHANGE_URL=<your Vectros API host>/v1/auth/token/exchange
VITE_VECTROS_API_URL=<your Vectros API host>
```

Then:

```bash
npm run dev
```

Open the app, click **Continue**, and confirm you land on a real Auth0 login form (not an error
page). Signing in with a real account should redirect you back to the app, authenticated.

## 7. Optional — the Account page's self-service password reset and MFA

Every signed-in user has an **Account** page (from the user menu) offering two self-service
actions, both zero-backend by design (this app has none). Neither requires anything beyond what
you've already set up above, but each has a real prerequisite worth knowing about:

**Password reset** calls Auth0's own `/dbconnections/change_password` endpoint directly from the
browser — no code here to configure. It only works for a **database** connection (this app detects
that automatically from the signed-in user's `sub` claim and hides the button otherwise — a social
or enterprise-connection user's password, if any, is owned by their identity provider, not Auth0).
If you renamed your tenant's default database connection away from Auth0's out-of-box
`Username-Password-Authentication`, set `VITE_AUTH0_CONNECTION` in your `.env.local` to the real
name — see `.env.example`.

**Two-factor authentication** has no dedicated UI in this app at all — "Manage two-factor
authentication" just re-runs sign-in, and Auth0's own hosted Universal Login shows whatever MFA
enrollment/verification screen your tenant is configured for. To turn MFA on: **Security →
Multi-factor Auth** in the Auth0 dashboard, enable at least one factor (Authenticator app / SMS /
etc.), and set a policy — **Always** requires it for every login; **Adaptive** (paid plans) prompts
only when a login looks risky. Until you configure a policy, clicking the button is a harmless
no-op re-login.

If you want an in-app screen showing a user's own enrolled factors with add/remove controls (this
app deliberately doesn't build one), look at Auth0's newer **My Account API** — designed
specifically for a backend-less SPA like this one, but currently **Limited Early Access**; you'll
need to request it from your Auth0 account team before it's available on your tenant.

## Test vs. production

If you created two APIs in step 2, repeat step 3 (authorization), **step 3a (consent skipping —
easy to forget since it's a per-API toggle, not per-application)**, and step 5 (blueprint apply,
with `--tenant live` and the `casework-prod` audience) for the production side once you're ready
to deploy for real. Keeping the two fully separate — separate audiences, separate Vectros
tenants, ideally a dedicated test user you never use for anything real — means you can safely
automate testing against the test side without any risk to production data.

**Step 4's URLs are per-application, not per-API** — both Allowed Callback URLs and Allowed Logout
URLs take a single, comma-separated list covering every environment (`https://localhost:3003` for
local dev, plus your real production origin once you have one), rather than needing to be redone
per API. Add your production origin to both fields at the same time you do step 3a, not as an
afterthought when you first hit a broken logout in production.
