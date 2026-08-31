// ---------------------------------------------------------------------------
// useTouchedFieldErrors tests — the touched-gating logic for UX-2 (required-
// field errors rendering before the form is touched).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTouchedFieldErrors } from './useTouchedFieldErrors';
import type { FieldErrors } from '@vectros-ai/react';

describe('useTouchedFieldErrors', () => {
  it('hides all errors until the corresponding field is marked touched', () => {
    const { result } = renderHook(() => useTouchedFieldErrors({ name: 'required', age: 'enum' }));

    expect(result.current.visibleErrors).toEqual({});

    act(() => result.current.markTouched('name'));
    expect(result.current.visibleErrors).toEqual({ name: 'required' });

    act(() => result.current.markTouched('age'));
    expect(result.current.visibleErrors).toEqual({ name: 'required', age: 'enum' });
  });

  it('does not surface a touched field once its own error clears', () => {
    const { result, rerender } = renderHook(
      ({ errors }: { errors: FieldErrors }) => useTouchedFieldErrors(errors),
      { initialProps: { errors: { name: 'required' } as FieldErrors } },
    );
    act(() => result.current.markTouched('name'));
    expect(result.current.visibleErrors).toEqual({ name: 'required' });

    rerender({ errors: {} });
    expect(result.current.visibleErrors).toEqual({});
  });

  it('reset() clears touched state, so a reopened form starts pristine again', () => {
    const { result } = renderHook(() => useTouchedFieldErrors({ name: 'required' }));
    act(() => result.current.markTouched('name'));
    expect(result.current.visibleErrors).toEqual({ name: 'required' });

    act(() => result.current.reset());
    expect(result.current.visibleErrors).toEqual({});
  });
});
