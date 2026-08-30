import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBorrowerProfile, saveBorrowerProfile } from './borrower-profile-client';

afterEach(() => {
  vi.unstubAllEnvs();
});

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('borrower profile API client', () => {
  it('treats a missing profile as ok with a null profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(404, {
      success: false,
      error: { code: 'CASE_NOT_FOUND' },
    }));
    await expect(loadBorrowerProfile('case-1', fetcher)).resolves.toEqual({ ok: true, profile: null });
  });

  it('loads an existing profile with cookie credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test/');
    const profile = {
      id: 'profile-1',
      caseId: 'case-1',
      entityType: 'corporation',
      version: 1,
      registeredName: 'Sprout Trading Corp',
      tradeName: null,
      registrationNumber: null,
      tin: null,
      principalAddress: null,
      contactPersonName: null,
      contactPersonEmail: null,
      contactPersonPhone: null,
      dateEstablished: null,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
      beneficialOwners: [],
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: profile }));
    await expect(loadBorrowerProfile('case-1', fetcher)).resolves.toEqual({ ok: true, profile });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/onboarding/borrower/cases/case-1/profile',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('reports session expiry without leaking server internals', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, {}));
    await expect(loadBorrowerProfile('case-1', fetcher)).resolves.toEqual({
      ok: false,
      unauthenticated: true,
      message: 'Your session expired. Sign in again.',
    });
  });

  it('sends the full profile payload including beneficial owners as JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: { id: 'profile-1' },
    }));
    await saveBorrowerProfile('case-1', {
      entityType: 'corporation',
      registeredName: 'Sprout Trading Corp',
      beneficialOwners: [{ fullName: 'Owner One', ownershipPercentage: '100.00', isPep: false }],
    }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/onboarding/borrower/cases/case-1/profile',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          entityType: 'corporation',
          registeredName: 'Sprout Trading Corp',
          beneficialOwners: [{ fullName: 'Owner One', ownershipPercentage: '100.00', isPep: false }],
        }),
      }),
    );
  });

  it('maps stale-version and over-allocated-ownership failures to bounded messages', async () => {
    const stale = vi.fn().mockResolvedValue(response(409, {
      success: false,
      error: { code: 'STALE_PROFILE_VERSION', message: 'internal details ignored' },
    }));
    const overAllocated = vi.fn().mockResolvedValue(response(400, {
      success: false,
      error: { code: 'OWNERSHIP_PERCENTAGE_EXCEEDS_TOTAL' },
    }));
    const input = { entityType: 'sole_proprietorship' as const, registeredName: 'Solo', beneficialOwners: [] };
    await expect(saveBorrowerProfile('case-1', input, stale)).resolves.toEqual({
      ok: false,
      message: 'This profile changed elsewhere. The latest version has been reloaded.',
    });
    await expect(saveBorrowerProfile('case-1', input, overAllocated)).resolves.toEqual({
      ok: false,
      message: 'Beneficial owner percentages cannot add up to more than 100%.',
    });
  });
});
