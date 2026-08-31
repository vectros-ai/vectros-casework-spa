#!/usr/bin/env bash
# Local runner for the casework-spa e2e smoke suite — verify YOUR fork or
# deployment actually works end to end (sign-in, orgs, clients, cases,
# team/invite), using your own Auth0 test user (see .env.example).
#
# The app boots via Playwright's webServer block (Vite `npm run dev` in the
# repo root, its default port 3003 — that origin must already be registered
# as an Allowed Callback URL on your Auth0 application; see
# ../docs/AUTH0-SETUP.md) unless --deployed points this at a real deployed
# instance instead.
#
# Usage:
#   cp .env.example .env             # fill in SMOKE_USER_EMAIL/SMOKE_USER_PASSWORD
#   ./run.sh                         # all specs, local Vite vs your Vectros API
#   ./run.sh tests/01-login.spec.ts  # one spec
#   ./run.sh --deployed              # against a real deployed instance instead
#   ./run.sh -- --headed             # extra playwright args after --
#
# Exit codes: 0 pass · 1 test failures/runtime error · 2 prerequisite failed.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env from this directory, if present.
if [ -f ./.env ]; then set -a; . ./.env; set +a; fi

DEPLOYED=0
PLAYWRIGHT_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --deployed) DEPLOYED=1; shift ;;
        --) shift; PLAYWRIGHT_ARGS+=("$@"); break ;;
        *)  PLAYWRIGHT_ARGS+=("$1"); shift ;;
    esac
done

PASS=$'\xe2\x9c\x93'; FAIL=$'\xe2\x9c\x97'
step() { echo ""; echo "─── $1 ───"; }
ok()   { echo "  $PASS $1"; }
fail() { echo "  $FAIL $1" >&2; }

# -----------------------------------------------------------------------------
# Step 1: prereq checks
# -----------------------------------------------------------------------------
step "Prerequisite checks"
command -v node >/dev/null 2>&1 || { fail "node not on PATH (need >= 20)"; exit 2; }
ok "node $(node --version)"
[ -d node_modules ] || { fail "node_modules/ missing — run 'npm install' in this directory first"; exit 2; }
ok "node_modules present"

[ -n "${SMOKE_USER_EMAIL:-}" ] || { fail "SMOKE_USER_EMAIL not set — copy .env.example to .env and fill it in"; exit 2; }
[ -n "${SMOKE_USER_PASSWORD:-}" ] || { fail "SMOKE_USER_PASSWORD not set — copy .env.example to .env and fill it in"; exit 2; }
ok "smoke user: $SMOKE_USER_EMAIL"

if [ "$DEPLOYED" = 1 ]; then
    [ -n "${CASEWORK_SPA_DEPLOYED_URL:-}" ] || { fail "--deployed needs CASEWORK_SPA_DEPLOYED_URL set (in .env or your shell) to your deployment's URL"; exit 2; }
    ok "--deployed target: $CASEWORK_SPA_DEPLOYED_URL"
    ok "skipping app node_modules + local dev cert checks (no local Vite boot)"
else
    [ -d ../node_modules ] || { fail "../node_modules missing — run 'npm install' in the app root first"; exit 2; }
    ok "app node_modules present"
    if [ -f ../.cert/localhost-key.pem ] && [ -f ../.cert/localhost-cert.pem ]; then
        ok "local dev cert present (../.cert/)"
    else
        fail "../.cert/ missing a local dev cert — this suite runs the app over https"
        fail "(required so it can exercise the invite flow's acceptUrl validation), and the dev"
        fail "server falls back to plain http without one, which won't match this suite's baseURL."
        fail "Generate it once per clone/machine — see ../docs/AUTH0-SETUP.md."
        exit 2
    fi
fi

# -----------------------------------------------------------------------------
# Step 2: env for Playwright + the app's own webServer boot
# -----------------------------------------------------------------------------
export SMOKE_USER_EMAIL SMOKE_USER_PASSWORD
export VECTROS_API_BASE="${VECTROS_API_BASE:-https://api.vectros.ai}"
if [ "$DEPLOYED" = 1 ]; then
    export CASEWORK_SPA_URL="$CASEWORK_SPA_DEPLOYED_URL"
    export SKIP_WEBSERVER=1
else
    # https, not http — see playwright.config.ts's own comment: the app's
    # vite.config.ts serves https://localhost:3003 whenever a local dev cert
    # exists (required for the invite flow's acceptUrl validation), and this
    # suite needs to be able to exercise that flow, not just fall back to http.
    export CASEWORK_SPA_URL="https://localhost:3003"
fi

# -----------------------------------------------------------------------------
# Step 3: run Playwright
# -----------------------------------------------------------------------------
step "Running Playwright"
echo "  user:   $SMOKE_USER_EMAIL"
if [ "$DEPLOYED" = 1 ]; then
    echo "  target: deployed $CASEWORK_SPA_DEPLOYED_URL vs $VECTROS_API_BASE"
else
    echo "  target: local Vite https://localhost:3003 vs $VECTROS_API_BASE"
fi
echo "  args:   ${PLAYWRIGHT_ARGS[*]:-<all specs>}"
echo ""

# Scrub anything looking like the smoke user password from output. Escape
# EVERY non-alphanumeric char so a password containing a regex metacharacter
# can't break the sed expression (which would otherwise error out and swallow
# the entire run).
REDACT_PW=$(printf '%s' "$SMOKE_USER_PASSWORD" | sed 's/[^a-zA-Z0-9]/\\&/g')
# "${arr[@]+"${arr[@]}"}" not "${arr[@]}" -- macOS ships bash 3.2 as /bin/bash
# (still true today; GPLv3 licensing), and under `set -u` bash < 4.4 treats
# expanding a ZERO-element array as an unbound-variable error, aborting the
# whole script -- exactly the common case here (running with no extra
# playwright args at all). The `+alt` parameter-expansion form tests whether
# the array is SET rather than expanding it directly, which every bash
# version (3.2 included) handles safely regardless of element count.
if [ -n "$REDACT_PW" ]; then
    exec npx playwright test "${PLAYWRIGHT_ARGS[@]+"${PLAYWRIGHT_ARGS[@]}"}" 2>&1 \
        | sed -E "s/${REDACT_PW}/<REDACTED-PASSWORD>/g"
else
    exec npx playwright test "${PLAYWRIGHT_ARGS[@]+"${PLAYWRIGHT_ARGS[@]}"}"
fi
