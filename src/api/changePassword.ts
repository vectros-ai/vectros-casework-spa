// ---------------------------------------------------------------------------
// changePassword — a direct call to Auth0's own `/dbconnections/change_password`
// endpoint, NOT the Vectros API. This is deliberately the one API call in this
// app that bypasses `vectrosApiClient()` entirely: Auth0 hosts this endpoint
// specifically so a public client (no backend, no secret) can trigger its own
// password-reset email with nothing but the tenant domain + client id, both
// already public per config.ts's own header comment. No auth token is
// required or sent — the endpoint's own gate is "does this email exist on
// this connection," not "is the caller signed in."
//
// Only works for a DATABASE connection (Auth0's own restriction) — a social
// or enterprise-connection user has no Auth0-managed password to reset at
// all, which is why AccountPage only renders the calling UI when
// `useAuth().user.sub` starts with `auth0|` (see that page's own comment).
// ---------------------------------------------------------------------------

import { AUTH0_CONFIG } from '../config';

/** Auth0's Authentication API error shape for this endpoint — a plain OAuth-style
 *  `{error, error_description}` body, distinct from the Vectros SDK's own error shape
 *  (this call never goes through `vectrosApiClient()`, so `extractErrorMessage` doesn't apply). */
interface Auth0ErrorBody {
  readonly error?: string;
  readonly error_description?: string;
}

async function readErrorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.clone().json()) as Auth0ErrorBody;
    return body.error_description ?? body.error;
  } catch {
    // Not every failure mode returns JSON (e.g. a plain-text 429) — fall back to the raw body.
    try {
      const text = await res.text();
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Triggers Auth0's own password-reset email for `email` on this app's configured
 * database connection. Resolves once Auth0 has ACCEPTED the request — not once the
 * user has actually reset anything; the real reset happens entirely on Auth0's
 * hosted page after they click the emailed link. Always resolves the same way for
 * an existing vs. non-existent email (Auth0 doesn't distinguish in its response),
 * so this can't be used to enumerate accounts.
 */
export async function requestPasswordChange(email: string): Promise<void> {
  const res = await fetch(`https://${AUTH0_CONFIG.domain}/dbconnections/change_password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: AUTH0_CONFIG.clientId,
      email,
      connection: AUTH0_CONFIG.connection,
    }),
  });
  if (!res.ok) {
    const detail = await readErrorMessage(res);
    throw new Error(
      detail
        ? `Password reset request failed: ${detail}`
        : `Password reset request failed (${res.status}).`,
    );
  }
}
