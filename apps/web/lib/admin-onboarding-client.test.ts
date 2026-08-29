import { describe, expect, it, vi } from 'vitest';
import {
  loadAdminOnboardingWorkspace,
  loadAdminOnboardingCaseDetail,
  rejectOnboardingCase,
  requestOnboardingInformation,
  startOnboardingReview,
} from './admin-onboarding-client';

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const session = {
  user: { id: 'reviewer-1', name: 'Reviewer', email: 'reviewer@example.com' },
  roles: ['compliance_officer'],
  permissions: ['onboarding_cases.read', 'onboarding_cases.review'],
};

describe('admin onboarding client', () => {
  it('denies locally after server session resolution when queue-read permission is absent', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: { ...session, permissions: ['onboarding_cases.review'] },
    }));
    await expect(loadAdminOnboardingWorkspace({ page: 1, pageSize: 25 }, fetcher))
      .resolves.toEqual({ ok: false, reason: 'forbidden' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('loads bounded filters and assigned reviewer scope with cookie credentials', async () => {
    const queue = { cases: [], page: 2, pageSize: 25, total: 26 };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, data: session }))
      .mockResolvedValueOnce(response(200, { success: true, data: queue }));
    await expect(loadAdminOnboardingWorkspace({
      page: 2,
      pageSize: 25,
      caseType: 'borrower',
      status: 'submitted',
      assignedToMe: true,
    }, fetcher)).resolves.toEqual({ ok: true, session, queue });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3001/v1/admin/session-context',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3001/v1/admin/onboarding/cases?page=2&pageSize=25&caseType=borrower&status=submitted&assignedToMe=true',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('sends exact versions and trimmed reasons to each review command', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: {} }));
    await startOnboardingReview('case-1', 2, fetcher);
    await requestOnboardingInformation('case-1', 3, '  Provide clearer documents  ', fetcher);
    await rejectOnboardingCase('case-1', 3, '  Requirements were not met  ', fetcher);
    expect(fetcher.mock.calls.map(([, options]) => options?.body)).toEqual([
      JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 3, reason: 'Provide clearer documents' }),
      JSON.stringify({ version: 3, reason: 'Requirements were not met' }),
    ]);
  });

  it('maps assignment and stale conflicts without exposing server messages', async () => {
    const assigned = vi.fn().mockResolvedValue(response(403, {
      success: false,
      error: { code: 'NOT_ASSIGNED_REVIEWER', message: 'internal detail ignored' },
    }));
    const stale = vi.fn().mockResolvedValue(response(409, {
      success: false,
      error: { code: 'STALE_CASE_VERSION', message: 'internal detail ignored' },
    }));
    await expect(rejectOnboardingCase('case-1', 3, 'Valid rejection reason', assigned))
      .resolves.toEqual({ ok: false, message: 'Only the assigned reviewer can take that action.' });
    await expect(startOnboardingReview('case-1', 2, stale)).resolves.toEqual({
      ok: false,
      message: 'This case changed. The queue has been reloaded.',
    });
  });

  it('loads allowlisted staff case detail with immutable events', async () => {
    const detail = {
      id: 'case-1',
      applicantUserId: 'applicant-1',
      applicantName: 'Applicant',
      applicantEmail: 'applicant@example.com',
      caseType: 'investor',
      status: 'in_review',
      version: 3,
      assignedReviewerUserId: 'reviewer-1',
      submittedAt: '2026-08-19T00:00:00.000Z',
      decidedAt: null,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
      events: [{ id: 'event-1', eventType: 'review_started' }],
    };
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: detail }));
    await expect(loadAdminOnboardingCaseDetail('case-1', fetcher))
      .resolves.toEqual({ ok: true, detail });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/admin/onboarding/cases/case-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('maps forbidden staff detail without exposing server text', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(403, {
      success: false,
      error: { code: 'FORBIDDEN', message: 'internal detail ignored' },
    }));
    await expect(loadAdminOnboardingCaseDetail('case-1', fetcher)).resolves.toEqual({
      ok: false,
      message: 'Your account cannot view compliance case details.',
    });
  });
});
