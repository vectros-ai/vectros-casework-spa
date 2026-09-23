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
vectros blueprint apply blueprint/casework.blueprint.yaml --tenant test \
  --set companyName="Your Company" \
  --set auth0Domain=<your Auth0 domain> \
  --set auth0Audience=<the API identifier from step 2>
```

`blueprint apply` (`@vectros-ai/cli` 0.23.0 or later) provisions everything in the blueprint without minting a key,
which this app never uses.
`--tenant` is required and there is no default. It prints the account, tenant and context it is about to change
and asks first. Once the blueprint's service principal exists, re-running it (after editing the blueprint, or from
CI) needs `--confirm-existing-principal` together with `--yes` (or with no terminal); at a terminal it asks instead.
It deletes nothing unless you also pass `--prune`.

This tells Vectros to trust **access tokens** issued by your Auth0 tenant for the given audience,
and is what the token-exchange endpoint checks against when this app trades an Auth0 session for
a Vectros API credential. This app presents Auth0's access token, not its ID token — the two carry
different `aud` claims (the access token's `aud` is the API identifier from step 2; the ID token's
is your Client ID), and only the access token's `aud` matches what you register here. If you're
adapting this flow for your own app, sending the ID token instead is a real, easy mistake to make
and produces an opaque token-exchange rejection with no indication of which token was the problem.

### 5-verify. Prove you control the Auth0 tenant (Vectros 0.45.0+)

A newly registered issuer starts as **`pending_verification`** and accepts no token until you prove you
control the Auth0 application, so a sign-in is refused until this step is done. (An issuer registered before
0.45.0 is already active and needs nothing here.) `vectros blueprint apply` in step 5 still finishes, and exits `0`
because the apply itself succeeded; **the challenge and the exact command below are the end of its output, on
stderr**. A script that must not carry on over a pending issuer can pass `--require-verified-issuers`,
which makes `apply` exit `4` in that case instead. Needs `@vectros-ai/cli` 0.23.0 or later.

1. **Note the challenge.** `blueprint apply` printed a claim name (`https://vectros.ai/claims/issuer_challenge`), a
   one-time value and an expiry. Read them back at any time (`primary` is the `issuerId` in the blueprint):

   ```bash
   vectros issuers get primary --context casework --tenant test
   ```
2. **Add an Auth0 Action.** In Auth0, add a **post-login Action** that stamps the value into both tokens:
   **Actions → Library → Build Custom**, trigger **Login / Post Login**. Paste the code below, then use the key
   icon to **Add Secret** named `VECTROS_ISSUER_NONCE` whose value is the one-time value from step 1.

   ```js
   exports.onExecutePostLogin = async (event, api) => {
     const claim = 'https://vectros.ai/claims/issuer_challenge';
     api.idToken.setCustomClaim(claim, event.secrets.VECTROS_ISSUER_NONCE);
     api.accessToken.setCustomClaim(claim, event.secrets.VECTROS_ISSUER_NONCE);
   };
   ```

   Click **Deploy**, then go to **Actions → Triggers → post-login**, drag the Action between *Start* and
   *Complete*, and click **Apply**. A deployed Action that is not in the flow never runs. Actions apply to every
   application in the tenant; to limit this one to Casework, add
   `if (event.client.client_id !== '<your Client ID>') return;` as the first line of the function.
3. **Sign in once, after the Action is in the flow, and capture the access token.** A token from an earlier
   login does not carry the claim, so sign in again. Sign in through this app's Auth0 login with your browser's
   developer tools open; the response to the `POST https://<your Auth0 domain>/oauth/token` request carries
   an `access_token`. (The app's own token exchange with Vectros is refused while the issuer is pending; that
   is expected.) Save the access token to a file and answer the challenge. Use the **access token**, not the ID
   token: the ID token's audience is your Client ID, which is not the audience this issuer is registered with:

   ```bash
   vectros issuers verify primary --context casework --tenant test --idp-token-file ./idp-token.txt
   ```

   The registration becomes `active`. Prefer the file (or piping the token on stdin) to putting it on the
   command line, where it lands in your shell history. The token is checked once and never stored; delete the
   file afterwards. Note this is `--idp-token-file`, not `--token`: `--token` is your Vectros credential.
   If the command is refused with a 400, its message names the check that failed; the most common are these.
   *"does not carry the … claim"* means the Action is not deployed and in the post-login flow, its secret is
   unset, or the token came from a login made before that: fix it and sign in again. *"does not match this
   registration's verificationNonce"* means the secret holds a different value than `vectros issuers get`
   shows. *"audience does not include"* usually means the ID token was sent instead of the access token.
   A 404, a 409, a timeout or a server error is different: the CLI prints the command to run next
   (`vectros issuers get`), because a timeout can still have completed. Read the registration back before
   retrying; retrying a verify that did succeed answers *"not awaiting verification"*.
4. Optionally remove the Action (take it out of the post-login flow and click **Apply**, then delete it); the
   value is only checked once.

The verification is checked against your tenant's own published OpenID Connect discovery document, so
`auth0Domain` must be exactly the domain Auth0 reports as the issuer. The challenge expires seven days after
registration. If it lapses while the issuer is still pending, `vectros blueprint apply` and `vectros issuers get`
say so and name the two commands that replace it (`vectros issuers delete`, then re-run `blueprint apply`); nothing is
deleted for you, and the new registration gets a new value, so update the Action's secret to match and deploy
the Action again.

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
`vectros blueprint apply` in step 5 above; there is nothing to configure here for a standard Auth0
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
easy to forget since it's a per-API toggle, not per-application)**, and step 5 (`vectros blueprint apply`,
with `--tenant live` and the `casework-prod` audience, then step 5-verify for the production issuer) for the production side once you're ready
to deploy for real. Keeping the two fully separate — separate audiences, separate Vectros
tenants, ideally a dedicated test user you never use for anything real — means you can safely
automate testing against the test side without any risk to production data.

**Step 4's URLs are per-application, not per-API** — both Allowed Callback URLs and Allowed Logout
URLs take a single, comma-separated list covering every environment (`https://localhost:3003` for
local dev, plus your real production origin once you have one), rather than needing to be redone
per API. Add your production origin to both fields at the same time you do step 3a, not as an
afterthought when you first hit a broken logout in production.
