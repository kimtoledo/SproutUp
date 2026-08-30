export interface InvestorProfileInput {
  expectedVersion?: number;
  fullName: string;
  dateOfBirth?: string;
  nationality?: string;
  governmentIdType?: string;
  governmentIdNumber?: string;
  residentialAddress?: string;
  phoneNumber?: string;
  occupation?: string;
  sourceOfFunds?: string;
}

export interface InvestorProfile {
  id: string;
  caseId: string;
  version: number;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  governmentIdType: string | null;
  governmentIdNumber: string | null;
  residentialAddress: string | null;
  phoneNumber: string | null;
  occupation: string | null;
  sourceOfFunds: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LoadInvestorProfileResult =
  | { ok: true; profile: InvestorProfile | null }
  | { ok: false; message: string; unauthenticated?: boolean };

export type SaveInvestorProfileResult =
  | { ok: true; profile: InvestorProfile }
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

const errorMessages: Record<string, string> = {
  CASE_NOT_FOUND: 'That case is no longer available.',
  CASE_NOT_EDITABLE: 'This profile can no longer be edited for the current case state.',
  STALE_PROFILE_VERSION: 'This profile changed elsewhere. The latest version has been reloaded.',
  FORBIDDEN: 'Your account does not have permission for this profile.',
  VALIDATION_ERROR: 'Check the submitted details and try again.',
};

export async function loadInvestorProfile(
  caseId: string,
  fetcher: FetchLike = fetch,
): Promise<LoadInvestorProfileResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/onboarding/investor/cases/${caseId}/profile`,
      requestInit('GET'),
    );
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 404) return { ok: true, profile: null };
    if (!response.ok) {
      return { ok: false, message: 'Your profile could not be loaded. Please try again.' };
    }
    const envelope = await parseEnvelope<InvestorProfile>(response);
    if (!envelope?.success || !envelope.data) {
      return { ok: false, message: 'Your profile could not be loaded. Please try again.' };
    }
    return { ok: true, profile: envelope.data };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export async function saveInvestorProfile(
  caseId: string,
  input: InvestorProfileInput,
  fetcher: FetchLike = fetch,
): Promise<SaveInvestorProfileResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/onboarding/investor/cases/${caseId}/profile`,
      requestInit('POST', { ...input }),
    );
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    const envelope = await parseEnvelope<InvestorProfile>(response);
    if (response.ok && envelope?.success && envelope.data) {
      return { ok: true, profile: envelope.data };
    }
    const code = envelope?.error?.code ?? '';
    return { ok: false, message: errorMessages[code] ?? 'The profile could not be saved. Please try again.' };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}
