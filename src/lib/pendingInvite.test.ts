// ---------------------------------------------------------------------------
// pendingInvite.ts — direct unit coverage. This file had no dedicated
// test at all, only indirect exercise through AcceptInvitePage/CallbackPage's
// own suites, neither of which probes the read-then-clear contract directly —
// that a second read after the first returns null, which is the whole point
// of the "destructive read" the header comment documents.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest';
import { readAndClearPendingInviteToken, storePendingInviteToken } from './pendingInvite';

afterEach(() => {
  sessionStorage.clear();
});

describe('storePendingInviteToken / readAndClearPendingInviteToken', () => {
  it('round-trips a stored token', () => {
    storePendingInviteToken('inv_abc123');
    expect(readAndClearPendingInviteToken()).toBe('inv_abc123');
  });

  it('clears the token on read — a second read returns null', () => {
    storePendingInviteToken('inv_abc123');
    readAndClearPendingInviteToken();

    expect(readAndClearPendingInviteToken()).toBeNull();
  });

  it('returns null when nothing was ever stored', () => {
    expect(readAndClearPendingInviteToken()).toBeNull();
  });

  it('a later store overwrites an earlier, unread one', () => {
    storePendingInviteToken('inv_first');
    storePendingInviteToken('inv_second');

    expect(readAndClearPendingInviteToken()).toBe('inv_second');
  });
});
