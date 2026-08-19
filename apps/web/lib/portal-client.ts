export type CaseType = 'borrower' | 'investor';
export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'needs_information'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export interface PortalSession {
  user: { id: string; name: string; email: string };
  roles: string[];
  permissions: string[];
}

export interface PortalCase {
  id: string;
  caseType: CaseType;
  status: CaseStatus;
  version: number;
  assignedReviewerUserId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PortalLoadResult =
  | { ok: true; session: PortalSession; cases: PortalCase[] }
  | { ok: false; reason: 'unauthenticated' | 'unavailable' };

export type PortalCommandResult =
  | { ok: true }
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

function requestInit(method: string, body?: Record<string, unknown>): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
}

async function parseEnvelope<T>(response: Pick<Response, 'json'>): Promise<Envelope<T> | null> {
  try {
    return await response.json() as Envelope<T>;
  } catch {
    return null;
  }
}

export async function loadPortal(fetcher: FetchLike = fetch): Promise<PortalLoadResult> {
  try {
    const sessionResponse = await fetcher(
      `${apiBaseUrl()}/v1/session-context`,
      requestInit('GET'),
    );
    if (sessionResponse.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (!sessionResponse.ok) return { ok: false, reason: 'unavailable' };
    const sessionEnvelope = await parseEnvelope<PortalSession>(sessionResponse);
    if (!sessionEnvelope?.success || !sessionEnvelope.data) {
      return { ok: false, reason: 'unavailable' };
    }

    const casesResponse = await fetcher(
      `${apiBaseUrl()}/v1/onboarding/cases`,
      requestInit('GET'),
    );
    if (casesResponse.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (!casesResponse.ok) return { ok: false, reason: 'unavailable' };
    const casesEnvelope = await parseEnvelope<PortalCase[]>(casesResponse);
    if (!casesEnvelope?.success || !Array.isArray(casesEnvelope.data)) {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, session: sessionEnvelope.data, cases: casesEnvelope.data };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

const commandMessages: Record<string, string> = {
  OPEN_CASE_EXISTS: 'You already have an open case for that journey.',
  CASE_NOT_FOUND: 'That case is no longer available.',
  STALE_CASE_VERSION: 'This case changed. The latest version has been reloaded.',
  INVALID_CASE_TRANSITION: 'That action is no longer available for the current case state.',
  FORBIDDEN: 'Your account does not have permission for that journey.',
  VALIDATION_ERROR: 'Check the submitted details and try again.',
};

async function command(
  path: string,
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<PortalCommandResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}${path}`, requestInit('POST', body));
    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    const envelope = await parseEnvelope<never>(response);
    const code = envelope?.error?.code ?? '';
    return {
      ok: false,
      message: commandMessages[code] ?? 'The action could not be completed. Please try again.',
    };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export function createOnboardingCase(
  caseType: CaseType,
  fetcher: FetchLike = fetch,
): Promise<PortalCommandResult> {
  return command('/v1/onboarding/cases', { caseType }, fetcher);
}

export function submitOnboardingCase(
  caseId: string,
  version: number,
  fetcher: FetchLike = fetch,
): Promise<PortalCommandResult> {
  return command(`/v1/onboarding/cases/${caseId}/submit`, { version }, fetcher);
}

export function withdrawOnboardingCase(
  caseId: string,
  version: number,
  reason: string,
  fetcher: FetchLike = fetch,
): Promise<PortalCommandResult> {
  return command(`/v1/onboarding/cases/${caseId}/withdraw`, { version, reason: reason.trim() }, fetcher);
}

export async function signOut(fetcher: FetchLike = fetch): Promise<void> {
  try {
    await fetcher(`${apiBaseUrl()}/v1/auth/sign-out`, requestInit('POST', {}));
  } catch {
    // Navigation still clears the authenticated UI; the server cookie remains authoritative.
  }
}
