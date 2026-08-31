// ---------------------------------------------------------------------------
// MUI theme — derived from BRAND so re-skinning is one-file (src/brand.ts).
//
// Flat, dense data UI: elevation/shadow stripped from Paper, Card, Button,
// AppBar; borders carry visual structure instead. Kept in the same visual
// language as the other Vectros reference apps.
// ---------------------------------------------------------------------------

import { createTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import { BRAND } from './brand';

export const theme: Theme = createTheme({
  palette: {
    primary: { main: BRAND.colors.primary },
    background: {
      default: BRAND.colors.background,
      paper: BRAND.colors.surface,
    },
    text: {
      primary: BRAND.colors.textPrimary,
      secondary: BRAND.colors.textSecondary,
    },
    divider: BRAND.colors.divider,
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    h1: { fontWeight: 800, letterSpacing: '-0.02em' },
    h2: { fontWeight: 800, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 700, letterSpacing: '-0.02em' },
    h6: { fontWeight: 700, letterSpacing: '-0.02em' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': { boxShadow: 'none' },
          '&:active': { boxShadow: 'none' },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: `1px solid ${BRAND.colors.divider}`,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          border: `1px solid ${BRAND.colors.divider}`,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: BRAND.colors.divider,
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: { root: { boxShadow: 'none' } },
    },
  },
});
