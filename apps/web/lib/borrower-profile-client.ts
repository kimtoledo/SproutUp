export type BorrowerEntityType = 'sole_proprietorship' | 'partnership' | 'corporation';

export interface BeneficialOwnerInput {
  fullName: string;
  /** Decimal string, e.g. "25.50". */
  ownershipPercentage: string;
  nationality?: string;
  isPep: boolean;
}

export interface BorrowerProfileInput {
  expectedVersion?: number;
  entityType: BorrowerEntityType;
  registeredName: string;
  tradeName?: string;
  registrationNumber?: string;
  tin?: string;
  principalAddress?: string;
  contactPersonName?: string;
  contactPersonEmail?: string;
  contactPersonPhone?: string;
  dateEstablished?: string;
  beneficialOwners: BeneficialOwnerInput[];
}

export interface BeneficialOwner extends BeneficialOwnerInput {
  id: string;
  createdAt: string;
}

export interface BorrowerProfile {
  id: string;
  caseId: string;
  entityType: BorrowerEntityType;
  version: number;
  registeredName: string;
  tradeName: string | null;
  registrationNumber: string | null;
  tin: string | null;
  principalAddress: string | null;
  contactPersonName: string | null;
  contactPersonEmail: string | null;
  contactPersonPhone: string | null;
  dateEstablished: string | null;
  createdAt: string;
  updatedAt: string;
  beneficialOwners: BeneficialOwner[];
}

export type LoadBorrowerProfileResult =
  | { ok: true; profile: BorrowerProfile | null }
  | { ok: false; message: string; unauthenticated?: boolean };

export type SaveBorrowerProfileResult =
  | { ok: true; profile: BorrowerProfile }
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
  OWNERSHIP_PERCENTAGE_EXCEEDS_TOTAL: 'Beneficial owner percentages cannot add up to more than 100%.',
  FORBIDDEN: 'Your account does not have permission for this profile.',
  VALIDATION_ERROR: 'Check the submitted details and try again.',
};

export async function loadBorrowerProfile(
  caseId: string,
  fetcher: FetchLike = fetch,
): Promise<LoadBorrowerProfileResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/onboarding/borrower/cases/${caseId}/profile`,
      requestInit('GET'),
    );
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 404) return { ok: true, profile: null };
    if (!response.ok) {
      return { ok: false, message: 'Your profile could not be loaded. Please try again.' };
    }
    const envelope = await parseEnvelope<BorrowerProfile>(response);
    if (!envelope?.success || !envelope.data) {
      return { ok: false, message: 'Your profile could not be loaded. Please try again.' };
    }
    return { ok: true, profile: envelope.data };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export async function saveBorrowerProfile(
  caseId: string,
  input: BorrowerProfileInput,
  fetcher: FetchLike = fetch,
): Promise<SaveBorrowerProfileResult> {
  try {
    const response = await fetcher(
      `${apiBaseUrl()}/v1/onboarding/borrower/cases/${caseId}/profile`,
      requestInit('POST', { ...input }),
    );
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    const envelope = await parseEnvelope<BorrowerProfile>(response);
    if (response.ok && envelope?.success && envelope.data) {
      return { ok: true, profile: envelope.data };
    }
    const code = envelope?.error?.code ?? '';
    return { ok: false, message: errorMessages[code] ?? 'The profile could not be saved. Please try again.' };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}
