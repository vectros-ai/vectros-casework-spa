# Setting up Vercel for Casework

This app ships no application server — see the root README's "Why no backend?" — so hosting it is
just serving a static bundle. This walks through doing that on [Vercel](https://vercel.com), the
easiest option for a Vite SPA and the one this doc covers in depth. Any static host works
(Netlify, S3+CloudFront, GitHub Pages with a rewrite rule) — the concepts below (environment
variables, the client-side-routing rewrite, registering the deployed URL with Auth0) carry over to
any of them, but the exact steps are Vercel-specific.

**Prerequisite**: an Auth0 tenant already set up per [`AUTH0-SETUP.md`](AUTH0-SETUP.md), and this
app's own [`../blueprint/casework.blueprint.yaml`](../blueprint/casework.blueprint.yaml) applied to
your Vectros deployment. You'll need the deployed URL from this doc to finish a step in that one
(registering callback URLs) — the two are meant to be done together, not strictly
one-then-the-other.

## 1. Recommended shape: two Vercel projects, mirroring your two Auth0 APIs

If you followed `AUTH0-SETUP.md`'s recommendation to create two Auth0 APIs (test/prod), mirror that
with **two separate Vercel projects** — e.g. `casework-test` and `casework`. Two plain projects
work identically on every Vercel plan, including the free tier, and give you fully independent
environment variables, deploy history, and (optionally) custom domains per environment — simpler to
reason about than one project's Preview/Production env-var split, which is really a per-branch/PR
concept rather than a second stable environment you'd bookmark and demo from.

## 2. Create the project

**Vercel dashboard → Add New → Project → Import Git Repository**, and connect your fork. Vercel
auto-detects this as a Vite project (Build Command `vite build`, Output Directory `dist`) — accept
the defaults **except the Build Command**: override it to `npm run build`. This app's actual build
script is `tsc --noEmit && vite build` — the bare `vite build` Vercel detects skips the typecheck
gate, which would let a real type error ship silently.

Do **not** connect a repo yet if you'd rather deploy via the Vercel CLI instead (§6 below) — that
path creates the project without any Git connection at all.

**If connecting fails with `You need to add a Login Connection to your GitHub account first`**:
your Vercel account has never linked the GitHub identity that owns your fork — common the first
time you fork to a personal account different from whatever you originally signed into Vercel with.
Vercel Account Settings → Login Connections (or accept the GitHub App authorization prompt Vercel
shows when it can find one) fixes it; there's nothing wrong with your fork or this app. Confirmed
hitting this for real forking to a personal GitHub account — §6's CLI path creates the project fine
either way, just without automatic deploy-on-push until the connection is fixed.

## 3. Set environment variables

**Settings → Environment Variables**, scoped to **Production**: the same five `VITE_*` values from
your `.env.local` (see `.env.example` for what each one means). None of them are secrets — see that
file's own header comment for why.

## 4. Deploy, then fix Deployment Protection if you hit a redirect to `vercel.com`

Push to your connected branch (or trigger a manual deploy). If the resulting URL redirects you to
`vercel.com/sso-api` instead of showing the app, **Vercel Deployment Protection ("Vercel
Authentication") is on** — a default for team-scoped Vercel accounts that requires anyone viewing
the deployment to be logged into your Vercel team. This isn't just an inconvenience: it blocks
Auth0's own callback redirect too, breaking sign-in even for you.

Turn it off for Production: **Settings → Deployment Protection**, or via the CLI:

```bash
vercel project protection disable <your-project-name> --sso
```

## 5. Client-side routing already works — here's why, in case you move hosts

This repo ships a [`vercel.json`](../vercel.json) with a catch-all rewrite to `index.html`. Without
it, a direct navigation to any route other than `/` — Auth0's `/callback` redirect, specifically —
would 404: this is a client-side-routed SPA (react-router), so `/callback` only exists as a route
the app's own JavaScript handles after it loads, not as a real file Vercel's static server can find.
The rewrite tells Vercel to serve `index.html` for anything that isn't an actual static asset (real
files — the JS/CSS bundles — are still served directly; the rewrite is a fallback, checked after the
filesystem, not instead of it). If you move to a different static host, port the same idea: whatever
that host calls its "SPA fallback" or "custom 404 page" setting, point it at `index.html`.

## 6. Alternative: deploy via the Vercel CLI, no Git connection

If you'd rather not connect a Git provider — deploying from CI yourself, or from inside a larger
monorepo where Vercel's own build sandbox would need extra configuration to reach this app's
dependencies — you can create and deploy the project entirely from the CLI instead:

```bash
npm install -g vercel
vercel login
cd ui/casework-spa   # or wherever this app lives in your repo
vercel link          # creates the project, no Git connection — first run only
vercel build --prod
vercel deploy --prebuilt --prod
```

On a freshly-linked project with no dashboard Build Command override ever set, `vercel build` has
been observed running this app's own `npm run build` script (`tsc --noEmit && vite build`)
correctly — not the bare `vite build` step 2 warns the dashboard's own Vite-framework
auto-detection can silently fall back to. That's a real, encouraging data point, but not a
guarantee this path is categorically exempt from that warning: treat it the same as step 2 either
way — confirm **Settings → Build & Development Settings → Build Command** actually reads
`npm run build` for whichever project you're deploying, especially after a project's settings are
ever reset. `vercel deploy --prebuilt` uploads exactly what `vercel build` produced
(`.vercel/output`), with no rebuild on Vercel's infrastructure. Environment variables (step 3) and
Deployment Protection (step 4) still apply the same way regardless of which path created the
project.

**Scripting this (CI, or a coding agent driving the deploy) instead of running it interactively**:
`vercel link`'s prompts need a live terminal by default. Skip them explicitly:

```bash
vercel link --yes --scope <your-team-or-username> --project <project-name>
```

`--project` names a brand-new project just as well as an existing one — you don't need to create it
in the dashboard first. `vercel build` and `vercel deploy` above already run non-interactively with
no extra flags needed.

## 7. Finish the Auth0 side

Add this deployment's URL to your Auth0 application's **Allowed Callback URLs**, **Allowed Logout
URLs**, and **Allowed Web Origins** — `AUTH0-SETUP.md` step 4 covers the exact fields; these are
per-application settings, so add every environment's URL to the same comma-separated list rather
than needing separate configuration per API.

## Test vs. production

Repeat this whole doc for your production Vercel project once you're ready — separate project,
separate env vars pointing at your prod Auth0 API and live Vectros tenant, same Deployment
Protection and Auth0-callback steps. Keeping test and prod on genuinely separate infrastructure
(separate Vercel projects, separate Auth0 APIs, separate Vectros tenants per `AUTH0-SETUP.md`) means
you can redeploy and test freely on one without any risk to the other.
