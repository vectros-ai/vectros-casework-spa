// ---------------------------------------------------------------------------
// NotFoundPage — chrome-less 404 for any unmatched route.
// ---------------------------------------------------------------------------

import { Box, Button, Stack, Typography } from '@mui/material';
import { FormattedMessage } from 'react-intl';

export function NotFoundPage(): React.JSX.Element {
  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}
    >
      <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="notFound.title" />
        </Typography>
        <Typography color="text.secondary">
          <FormattedMessage id="notFound.body" />
        </Typography>
        <Button href="/" variant="contained">
          <FormattedMessage id="notFound.homeLink" />
        </Button>
      </Stack>
    </Box>
  );
}
