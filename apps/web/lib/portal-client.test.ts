import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadPortal,
  submitOnboardingCase,
  withdrawOnboardingCase,
} from './portal-client';

afterEach(() => {
  vi.unstubAllEnvs();
});

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('portal API client', () => {
  it('stops at an unauthenticated session without requesting case data', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, {}));
    await expect(loadPortal(fetcher)).resolves.toEqual({ ok: false, reason: 'unauthenticated' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('loads server-resolved context then owned cases with cookie credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test/');
    const session = {
      user: { id: 'user-1', name: 'Pilot User', email: 'pilot@example.com' },
      roles: ['sme_borrower'],
      permissions: ['borrower_onboarding.manage_own'],
    };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, data: session }))
      .mockResolvedValueOnce(response(200, { success: true, data: [] }));
    await expect(loadPortal(fetcher)).resolves.toEqual({ ok: true, session, cases: [] });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'https://api.sproutup.test/v1/session-context',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'https://api.sproutup.test/v1/onboarding/cases',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends the exact optimistic case version and withdrawal reason', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: {} }));
    await submitOnboardingCase('case-1', 4, fetcher);
    await withdrawOnboardingCase('case-1', 5, '  Applicant changed direction  ', fetcher);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/v1/onboarding/cases/case-1/submit',
      expect.objectContaining({ body: JSON.stringify({ version: 4 }) }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/v1/onboarding/cases/case-1/withdraw',
      expect.objectContaining({
        body: JSON.stringify({ version: 5, reason: 'Applicant changed direction' }),
      }),
    );
  });

  it('maps stale state and session expiry without rendering server internals', async () => {
    const stale = vi.fn().mockResolvedValue(response(409, {
      success: false,
      error: { code: 'STALE_CASE_VERSION', message: 'internal details ignored' },
    }));
    const expired = vi.fn().mockResolvedValue(response(401, {}));
    await expect(submitOnboardingCase('case-1', 1, stale)).resolves.toEqual({
      ok: false,
      message: 'This case changed. The latest version has been reloaded.',
    });
    await expect(submitOnboardingCase('case-1', 1, expired)).resolves.toEqual({
      ok: false,
      unauthenticated: true,
      message: 'Your session expired. Sign in again.',
    });
  });
});
