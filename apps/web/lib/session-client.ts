export interface OwnSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

export type SessionListResult =
  | { ok: true; sessions: OwnSession[] }
  | { ok: false; reason: 'unauthenticated' | 'unavailable' };

export type SessionCommandResult =
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

function init(method: string): RequestInit {
  return { method, credentials: 'include' };
}

async function envelope<T>(response: Pick<Response, 'json'>): Promise<Envelope<T> | null> {
  try {
    return await response.json() as Envelope<T>;
  } catch {
    return null;
  }
}

export async function loadOwnSessions(fetcher: FetchLike = fetch): Promise<SessionListResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/sessions`, init('GET'));
    if (response.status === 401) return { ok: false, reason: 'unauthenticated' };
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const result = await envelope<OwnSession[]>(response);
    if (!result?.success || !Array.isArray(result.data)) return { ok: false, reason: 'unavailable' };
    return { ok: true, sessions: result.data };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function revokeOwnSession(
  sessionId: string,
  fetcher: FetchLike = fetch,
): Promise<SessionCommandResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}/v1/sessions/${sessionId}`, init('DELETE'));
    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, unauthenticated: true, message: 'Your session expired. Sign in again.' };
    }
    if (response.status === 404) return { ok: false, message: 'That session is already signed out.' };
    return { ok: false, message: 'That session could not be signed out. Please try again.' };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}
