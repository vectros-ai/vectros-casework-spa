// ---------------------------------------------------------------------------
// useInferenceModels — the inference model registry for the Ask panel's model
// picker. `listInferenceModels` returns the full catalogue annotated with plan
// tiers (`availableOn`) and per-1k-token credit rates. We soft-annotate (show
// all, label tiers/rates) rather than hard-gate — there's no clean client-side
// source for the tenant's plan tier.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Vectros } from '@vectros-ai/sdk';

import { vectrosApiClient } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';

export function useInferenceModels(enabled = true): UseQueryResult<Vectros.ModelsResponse> {
  return useQuery({
    queryKey: dataQueryKeys.inferenceModels(),
    queryFn: () => vectrosApiClient().inference.listInferenceModels(),
    // The catalogue rarely changes within a session — cache generously.
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}
