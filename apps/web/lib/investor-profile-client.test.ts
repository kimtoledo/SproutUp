import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadInvestorProfile, saveInvestorProfile } from './investor-profile-client';

afterEach(() => {
  vi.unstubAllEnvs();
});

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('investor profile API client', () => {
  it('treats a missing profile as ok with a null profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(404, {
      success: false,
      error: { code: 'CASE_NOT_FOUND' },
    }));
    await expect(loadInvestorProfile('case-1', fetcher)).resolves.toEqual({ ok: true, profile: null });
  });

  it('loads an existing profile with cookie credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test/');
    const profile = {
      id: 'profile-1',
      caseId: 'case-1',
      version: 1,
      fullName: 'Juana Dela Cruz',
      dateOfBirth: null,
      nationality: null,
      governmentIdType: null,
      governmentIdNumber: null,
      residentialAddress: null,
      phoneNumber: null,
      occupation: null,
      sourceOfFunds: null,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: profile }));
    await expect(loadInvestorProfile('case-1', fetcher)).resolves.toEqual({ ok: true, profile });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/onboarding/investor/cases/case-1/profile',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('reports session expiry without leaking server internals', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, {}));
    await expect(loadInvestorProfile('case-1', fetcher)).resolves.toEqual({
      ok: false,
      unauthenticated: true,
      message: 'Your session expired. Sign in again.',
    });
  });

  it('sends the profile payload as JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: { id: 'profile-1' },
    }));
    await saveInvestorProfile('case-1', { fullName: 'Juana Dela Cruz', nationality: 'Filipino' }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/onboarding/investor/cases/case-1/profile',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fullName: 'Juana Dela Cruz', nationality: 'Filipino' }),
      }),
    );
  });

  it('maps a stale-version failure to a bounded message', async () => {
    const stale = vi.fn().mockResolvedValue(response(409, {
      success: false,
      error: { code: 'STALE_PROFILE_VERSION', message: 'internal details ignored' },
    }));
    await expect(
      saveInvestorProfile('case-1', { fullName: 'Juana Dela Cruz' }, stale),
    ).resolves.toEqual({
      ok: false,
      message: 'This profile changed elsewhere. The latest version has been reloaded.',
    });
  });
});
