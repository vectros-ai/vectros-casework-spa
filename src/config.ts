// ---------------------------------------------------------------------------
// Runtime configuration — typed, validated at module load.
//
// Why fail-fast: a missing env var silently falling back to '' makes
// auth0-spa-js throw deep inside its own code with an opaque error a
// developer can't pattern-match. Throwing here, at module load, means the
// page surfaces a clear "Configuration error" boundary instead.
//
// None of these are secrets. An Auth0 SPA application's domain/client-id are
// public identifiers by design (OAuth's public-client model — the actual
// proof of identity is the user's Auth0 session, established via PKCE, never
// a value held in this bundle). The exchange + API URLs are just endpoints.
// ---------------------------------------------------------------------------

function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Configuration error: ${name} is not set. ` +
        `See .env.example for the required variables. ` +
        `In production this is set at build time by your deployment pipeline.`,
    );
  }
  return value;
}

export interface Auth0Config {
  /** Auth0 tenant domain, e.g. `acme-corp.us.auth0.com` — no scheme, no trailing slash. */
  readonly domain: string;
  /** Auth0 application's Client ID. */
  readonly clientId: string;
  /**
   * The Auth0 API identifier (audience) this application is authorized for.
   * Must match the audience the Vectros blueprint registered this issuer
   * under — the exchange endpoint resolves the target tenant + context from
   * the (issuer, audience) pair.
   */
  readonly audience: string;
  /**
   * This app's own callback route — must exactly match an "Allowed Callback
   * URL" configured on the Auth0 application. Derived from the current
   * origin rather than read from env, so it's correct in every environment
   * (local dev, preview deploys, prod) without a per-environment var.
   */
  readonly redirectUri: string;
  /**
   * The Auth0 database connection's name — used only by `changePassword.ts`'s
   * direct call to Auth0's `/dbconnections/change_password` endpoint (that
   * endpoint requires it explicitly; there's no way to omit it and let Auth0
   * infer the connection). Optional: defaults to `Username-Password-Authentication`,
   * Auth0's own out-of-box name for a tenant's default database connection —
   * right for most forks unless the connection was renamed. Not a secret
   * either way; the connection NAME (not credentials) is already public in
   * every Auth0 Universal Login URL that uses it.
   */
  readonly connection: string;
}

export const AUTH0_CONFIG: Auth0Config = {
  domain: requireEnv('VITE_AUTH0_DOMAIN'),
  clientId: requireEnv('VITE_AUTH0_CLIENT_ID'),
  audience: requireEnv('VITE_AUTH0_AUDIENCE'),
  redirectUri: `${window.location.origin}/callback`,
  connection: import.meta.env.VITE_AUTH0_CONNECTION?.trim() || 'Username-Password-Authentication',
};

/**
 * Vectros API configuration for the token-exchange bridge:
 *   - `exchangeUrl` — the full URL of `POST /v1/auth/token/exchange`. Trades
 *     the Auth0 ACCESS token for a Vectros partner-API bearer (RFC 8693) —
 *     not the ID token, whose `aud` claim is always the Auth0 client id and
 *     could never satisfy the exchange endpoint's audience check.
 *   - `apiUrl` — the Vectros API the minted bearer unlocks. All `/v1/*`
 *     data-plane traffic (records, schemas, entities, documents, search)
 *     routes through here, scoped to the (tenant, context) the exchange
 *     resolved.
 */
export interface VectrosApiConfig {
  readonly exchangeUrl: string;
  readonly apiUrl: string;
}

export const VECTROS_API_CONFIG: VectrosApiConfig = {
  exchangeUrl: requireEnv('VITE_VECTROS_EXCHANGE_URL'),
  apiUrl: requireEnv('VITE_VECTROS_API_URL'),
};
