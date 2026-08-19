import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadPortal,
  loadPortalCaseDetail,
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

  it('loads an owner-bound case timeline with cookie credentials', async () => {
    const detail = {
      id: 'case-1',
      caseType: 'borrower',
      status: 'needs_information',
      version: 4,
      assignedReviewerUserId: null,
      submittedAt: null,
      decidedAt: null,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
      events: [{
        id: 'event-1',
        eventType: 'information_requested',
        fromStatus: 'in_review',
        toStatus: 'needs_information',
        caseVersion: 4,
        actorType: 'user',
        actorUserId: 'reviewer-1',
        reason: 'Provide clearer registration evidence',
        occurredAt: '2026-08-19T00:00:00.000Z',
      }],
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: detail }));
    await expect(loadPortalCaseDetail('case-1', fetcher)).resolves.toEqual({ ok: true, detail });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/onboarding/cases/case-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('maps missing and malformed case history to bounded messages', async () => {
    const missing = vi.fn().mockResolvedValue(response(404, {
      success: false,
      error: { code: 'CASE_NOT_FOUND', message: 'ignored internal text' },
    }));
    const malformed = vi.fn().mockResolvedValue(response(200, { success: true, data: {} }));
    await expect(loadPortalCaseDetail('case-1', missing)).resolves.toEqual({
      ok: false,
      message: 'That case is no longer available.',
    });
    await expect(loadPortalCaseDetail('case-1', malformed)).resolves.toEqual({
      ok: false,
      message: 'The case history could not be loaded. Please try again.',
    });
  });
});
