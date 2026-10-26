// ---------------------------------------------------------------------------
// ModelPicker — the inference model selector for the Ask panel. Lists the full
// registry (soft-annotate: every model shown, labelled with its plan tiers +
// per-1k-token credit rate, plus the long-prompt rate for a model priced by
// prompt length; both are the US-served rate, which is what a default request
// is billed); the caller seeds the value from the registry's `defaultModel`.
// No hard plan-gating — selecting an out-of-tier model surfaces the backend's
// availability error on the stream. Controlled: parent owns the selected id.
// ---------------------------------------------------------------------------

import { Alert, FormControl, InputLabel, MenuItem, Select, Typography } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import { useIntl } from 'react-intl';

import { useInferenceModels } from '../hooks/useInferenceModels';

interface ModelPickerProps {
  /** The selected model id (`ModelInfo.id`); '' / undefined shows the label only. */
  readonly value: string | undefined;
  readonly onChange: (modelId: string) => void;
  readonly disabled?: boolean;
  /** Defer the model-registry fetch until the surface using this picker is
   *  actually visible (e.g. a drawer's own `open` state) — default true. */
  readonly enabled?: boolean;
}

export function ModelPicker({
  value,
  onChange,
  disabled,
  enabled = true,
}: ModelPickerProps): React.JSX.Element {
  const intl = useIntl();
  const { data, isPending, isError } = useInferenceModels(enabled);
  const label = intl.formatMessage({ id: 'ai.modelLabel' });

  if (isError) {
    return (
      <Alert severity="warning" sx={{ py: 0 }}>
        {intl.formatMessage({ id: 'ai.modelLoadError' })}
      </Alert>
    );
  }

  const models = data?.models ?? [];

  // Loaded but the registry is empty — say so rather than offering a silently
  // empty dropdown (the panel gates Send on a selected model anyway). A plain
  // note, NOT an Alert: an Alert carries role="alert" and would collide with
  // the panel's own inference-error alert (and over-announce a non-error
  // empty state).
  if (!isPending && models.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {intl.formatMessage({ id: 'ai.modelEmpty' })}
      </Typography>
    );
  }

  return (
    <FormControl size="small" sx={{ minWidth: 260 }} disabled={disabled === true || isPending}>
      <InputLabel id="ai-model-label">{label}</InputLabel>
      <Select
        labelId="ai-model-label"
        label={label}
        value={value ?? ''}
        displayEmpty
        onChange={(e: SelectChangeEvent) => onChange(e.target.value)}
        // Keep the closed control compact — annotations show only in the menu.
        // While the registry loads, show a loading hint instead of a blank box.
        renderValue={(v) =>
          isPending
            ? intl.formatMessage({ id: 'ai.modelLoading' })
            : (models.find((m) => m.id === v)?.name ?? v)
        }
      >
        {models.map((m) => {
          const longContext = m.longContext;
          return (
            // Two rate pairs make an option long; let it wrap rather than clip on a narrow screen.
            <MenuItem key={m.id} value={m.id} sx={{ whiteSpace: 'normal' }}>
              {m.name}
              {' — '}
              <Typography component="span" variant="caption" color="text.secondary">
                {m.availableOn.join('/')} ·{' '}
                {longContext != null
                  ? intl.formatMessage(
                      { id: 'ai.modelCreditsLongContext' },
                      {
                        inRate: m.regionPricing.us.input,
                        outRate: m.regionPricing.us.output,
                        tokens: longContext.promptTokensOver,
                        longInRate: longContext.us.input,
                        longOutRate: longContext.us.output,
                      },
                    )
                  : intl.formatMessage(
                      { id: 'ai.modelCredits' },
                      { inRate: m.regionPricing.us.input, outRate: m.regionPricing.us.output },
                    )}
              </Typography>
            </MenuItem>
          );
        })}
      </Select>
    </FormControl>
  );
}
