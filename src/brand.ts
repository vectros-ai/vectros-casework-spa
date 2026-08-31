// ---------------------------------------------------------------------------
// Brand configuration — single source of truth for product name, colors,
// and support contact.
//
// A fork re-brands by editing THIS FILE ONLY. No JSX in `src/` should
// hardcode a product name, a color hex, or a support email — move it here.
//
// Typography choices live in src/theme.ts (which consumes this module).
// ---------------------------------------------------------------------------

export interface BrandConfig {
  /** Short product name used in titles, app bar, auth pages. */
  readonly productName: string;
  /**
   * Logo image URL shown in the sidebar header. A light-on-dark mark (the
   * nav rail is dark). Served from `public/`; a fork drops in its own asset
   * and points this at it. Omit to fall back to the product name as text.
   */
  readonly logo?: string;
  /** Support contact for the in-app "stuck?" recovery links. */
  readonly supportEmail: string;
  /** Brand colors. Used to derive the MUI theme in src/theme.ts. */
  readonly colors: {
    readonly primary: string;
    readonly background: string;
    readonly surface: string;
    readonly textPrimary: string;
    readonly textSecondary: string;
    readonly divider: string;
  };
}

export const BRAND: BrandConfig = {
  productName: 'Casework',
  supportEmail: 'support@example.com',
  colors: {
    primary: '#0F172A',
    background: '#F9FAFB',
    surface: '#FFFFFF',
    textPrimary: '#09090B',
    textSecondary: '#52525B',
    divider: '#E4E4E7',
  },
};
