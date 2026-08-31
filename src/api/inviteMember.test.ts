// ---------------------------------------------------------------------------
// inviteMember.ts — direct unit coverage for the two-call sequence and its
// failure paths. `TeamPage.test.tsx` exercises this through the
// InviteDialog for the mainstream success/step-1-failure/step-2-failure
// cases; it never isolates inviteMember.ts's OWN defensive throw (a
// response with no userId) or pins the exact shape of
// `InviteMembershipGrantError` (which invite/cause it carries) independent
// of the UI that reads it.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { inviteMember, InviteMembershipGrantError } from './inviteMember';

vi.mock('./vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from './vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

describe('inviteMember', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('sends the invite then grants org membership, in that order, with the invitee (not the caller) stamped as the membership owner', async () => {
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new', emailSent: true });
    const createRecord = vi.fn().mockResolvedValue({ id: 'mem_1' });
    mockedClient.mockReturnValue({
      auth: { createInvite },
      records: { createRecord },
    } as never);

    const result = await inviteMember({ email: '  newbie@example.com  ', role: 'case-handler', orgId: 'org_1' });

    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'newbie@example.com', accessProfile: { roleId: 'case-handler' } }),
    );
    expect(createRecord).toHaveBeenCalledWith({
      body: {
        typeName: 'org_membership',
        scopes: ['org:org_1'],
        userId: 'usr_new',
        payload: { targetUserId: 'usr_new', level: 'member' },
      },
    });
    expect(result).toEqual({ invite: { userId: 'usr_new', emailSent: true }, membership: { id: 'mem_1' } });
  });

  it('propagates a step-1 (invite) failure as an ordinary Error — never attempts the membership grant', async () => {
    const createInvite = vi.fn().mockRejectedValue(new Error('invite boom'));
    const createRecord = vi.fn();
    mockedClient.mockReturnValue({
      auth: { createInvite },
      records: { createRecord },
    } as never);

    await expect(inviteMember({ email: 'a@b.com', role: 'case-handler', orgId: 'org_1' })).rejects.toThrow(
      'invite boom',
    );
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('throws before attempting the membership grant when the invite response carries no userId', async () => {
    const createInvite = vi.fn().mockResolvedValue({ emailSent: true }); // no userId
    const createRecord = vi.fn();
    mockedClient.mockReturnValue({
      auth: { createInvite },
      records: { createRecord },
    } as never);

    await expect(inviteMember({ email: 'a@b.com', role: 'case-handler', orgId: 'org_1' })).rejects.toThrow(
      'did not return a userId for the invite',
    );
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('wraps a step-2 (membership grant) failure in InviteMembershipGrantError, carrying the successful invite and the underlying cause', async () => {
    const invite = { userId: 'usr_new', emailSent: true };
    const createInvite = vi.fn().mockResolvedValue(invite);
    const cause = new Error('membership write boom');
    const createRecord = vi.fn().mockRejectedValue(cause);
    mockedClient.mockReturnValue({
      auth: { createInvite },
      records: { createRecord },
    } as never);

    const rejection = await inviteMember({ email: 'a@b.com', role: 'case-handler', orgId: 'org_1' }).catch(
      (e: unknown) => e,
    );

    expect(rejection).toBeInstanceOf(InviteMembershipGrantError);
    const err = rejection as InviteMembershipGrantError;
    expect(err.invite).toBe(invite);
    expect(err.cause).toBe(cause);
    expect(err.message).toContain('membership write boom');
  });

  it("InviteMembershipGrantError falls back to a generic message when the cause isn't an Error", async () => {
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new' });
    const createRecord = vi.fn().mockRejectedValue('a plain string rejection');
    mockedClient.mockReturnValue({
      auth: { createInvite },
      records: { createRecord },
    } as never);

    const rejection = await inviteMember({ email: 'a@b.com', role: 'case-handler', orgId: 'org_1' }).catch(
      (e: unknown) => e,
    );

    expect(rejection).toBeInstanceOf(InviteMembershipGrantError);
    expect((rejection as InviteMembershipGrantError).message).toBe(
      'Invite sent, but the org-level access grant failed.',
    );
  });
});
