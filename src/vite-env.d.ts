/// <reference types="vite/client" />

// ---------------------------------------------------------------------------
// Vite exposes env vars via `import.meta.env`. Declaring them here gives us
// type-safe access at the read site. Keep this list in sync with .env.example
// and src/config.ts.
// ---------------------------------------------------------------------------

interface ImportMetaEnv {
  readonly VITE_AUTH0_DOMAIN: string;
  readonly VITE_AUTH0_CLIENT_ID: string;
  readonly VITE_AUTH0_AUDIENCE: string;
  /** Optional — defaults to Auth0's own out-of-box database connection name if unset. See config.ts. */
  readonly VITE_AUTH0_CONNECTION?: string;
  readonly VITE_VECTROS_EXCHANGE_URL: string;
  readonly VITE_VECTROS_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
