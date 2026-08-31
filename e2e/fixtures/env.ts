/**
 * Resolves the casework-spa e2e suite's inputs from environment variables
 * (set by ./run.sh from your own .env — see .env.example).
 */
export interface CaseworkSpaEnv {
  /** App origin under test (https://localhost:3003 locally, or your deployed URL with --deployed). */
  appUrl: string;
  /** Your smoke Auth0 user's email — see .env.example. */
  email: string;
  /** Your smoke Auth0 user's password — see .env.example. */
  password: string;
  /** Your Vectros API base — used by assertions, not the login itself. */
  vectrosApiBase: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. ` +
        `Run via ./run.sh, or export it manually. ` +
        `See ./README.md "Setup".`,
    );
  }
  return v;
}

export function loadCaseworkSpaEnv(): CaseworkSpaEnv {
  return {
    appUrl: process.env.CASEWORK_SPA_URL || 'https://localhost:3003',
    email: required('SMOKE_USER_EMAIL'),
    password: required('SMOKE_USER_PASSWORD'),
    vectrosApiBase: process.env.VECTROS_API_BASE || 'https://api.vectros.ai',
  };
}
