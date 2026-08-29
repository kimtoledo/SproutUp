import type { CaseStatus, CaseType, PortalCaseEvent, PortalSession } from './portal-client';

export interface AdminOnboardingCase {
  id: string;
  caseType: CaseType;
  status: CaseStatus;
  version: number;
  assignedReviewerUserId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  applicantName: string;
  applicantEmail: string;
}

export interface AdminQueueFilters {
  page: number;
  pageSize: number;
  caseType?: CaseType;
  status?: CaseStatus;
  assignedToMe?: boolean;
}

export interface AdminOnboardingCaseDetail extends AdminOnboardingCase {
  applicantUserId: string;
  events: PortalCaseEvent[];
}

export type AdminWorkspaceResult =
  | {
    ok: true;
    session: PortalSession;
    queue: { cases: AdminOnboardingCase[]; page: number; pageSize: number; total: number };
  }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' | 'unavailable' };

export type AdminCommandResult =
  | { ok: true }
  | { ok: false; message: string; unauthenticated?: boolean };

export type AdminCaseDetailResult =
  | { ok: true; detail: AdminOnboardingCaseDetail }
  | { ok: false; message: string; unauthenticated?: boolean };

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string };
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function init(method: string, body?: Record<string, unknown>): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

async function envelope<T>(response: Pick<Response, 'json'>): Promise<Envelope<T> | null> {
  try {
    return await response.json() as Envelope<T>;
  } catch {
    return null;
  }
}

export async function loadAdminOnboardingWorkspace(
  filters: AdminQueueFilters,
  fetcher: FetchLike = fetch,
): Promise<AdminWorkspaceResult> {
  try {
    const sessionResponse = await fetcher(`${apiBaseUrl()}/v1/admin/session-context`, init('GET'));
    if (sessionResponse.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (!sessionResponse.ok) return { ok: false, reason: 'unavailable' };
    const session = await envelope<PortalSession>(sessionResponse);
    if (!session?.success || !session.data) return { ok: false, reason: 'unavailable' };
    if (!session.data.permissions.includes('onboarding_cases.read')) {
      return { ok: false, reason: 'forbidden' };
    }

    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.caseType) query.set('caseType', filters.caseType);
    if (filters.status) query.set('status', filters.status);
    if (filters.assignedToMe) query.set('assignedToMe', 'true');
    const queueResponse = await fetcher(
      `${apiBaseUrl()}/v1/admin/onboarding/cases?${query.toString()}`,
      init('GET'),
    );
    if (queueResponse.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (queueResponse.status === 403) return { ok: false, reason: 'forbidden' };
    if (!queueResponse.ok) return { ok: false, reason: 'unavailable' };
    const queue = await envelope<{
      cases: AdminOnboardingCase[];
      page: number;
      pageSize: number;
      total: number;
    }>(queueResponse);
    if (!queue?.success || !queue.data || !Array.isArray(queue.data.cases)) {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, session: session.data, queue: queue.data };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function loadAdminOnboardingCaseDetail(
  caseId: string,
  fetcher: FetchLike = fetch,
): Promise<AdminCaseDetailResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/admin/onboarding/cases/${caseId}`,
      init('GET'),
    );
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 403) {
      return { ok: false, message: 'Your account cannot view compliance case details.' };
    }
    if (response.status === 404) return { ok: false, message: 'That case is no longer available.' };
    if (!response.ok) {
      return { ok: false, message: 'The case detail could not be loaded. Please try again.' };
    }
    const result = await envelope<AdminOnboardingCaseDetail>(response);
    if (!result?.success || !result.data || !Array.isArray(result.data.events)) {
      return { ok: false, message: 'The case detail could not be loaded. Please try again.' };
    }
    return { ok: true, detail: result.data };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

const messages: Record<string, string> = {
  CASE_NOT_FOUND: 'That case is no longer available.',
  SELF_REVIEW_NOT_ALLOWED: 'Applicants cannot review their own case.',
  CASE_ASSIGNED_TO_OTHER: 'Another reviewer owns this case.',
  NOT_ASSIGNED_REVIEWER: 'Only the assigned reviewer can take that action.',
  STALE_CASE_VERSION: 'This case changed. The queue has been reloaded.',
  INVALID_CASE_TRANSITION: 'That action is no longer valid for the current state.',
  FORBIDDEN: 'Your account does not have review permission.',
  VALIDATION_ERROR: 'Check the submitted version and reason.',
};

async function command(
  caseId: string,
  action: 'start-review' | 'request-information' | 'reject' | 'approve',
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<AdminCommandResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/admin/onboarding/cases/${caseId}/${action}`,
      init('POST', body),
    );
    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    const result = await envelope<never>(response);
    return {
      ok: false,
      message: messages[result?.error?.code ?? ''] ?? 'The review action could not be completed.',
    };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export function startOnboardingReview(
  caseId: string,
  version: number,
  fetcher: FetchLike = fetch,
): Promise<AdminCommandResult> {
  return command(caseId, 'start-review', { version }, fetcher);
}

export function requestOnboardingInformation(
  caseId: string,
  version: number,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<AdminCommandResult> {
  return command(caseId, 'request-information', { version, reason: reason.trim() }, fetcher);
}

export function rejectOnboardingCase(
  caseId: string,
  version: number,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<AdminCommandResult> {
  return command(caseId, 'reject', { version, reason: reason.trim() }, fetcher);
}

export function approveOnboardingCase(
  caseId: string,
  version: number,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<AdminCommandResult> {
  return command(caseId, 'approve', { version, reason: reason.trim() }, fetcher);
}
