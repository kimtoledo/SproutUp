import type { PortalSession } from './portal-client';
import type { PortalSurface } from './portal-surface';

export interface AuthRoute {
  surface: Exclude<PortalSurface, 'main'>;
  path: string;
}

interface FetchLike {
  (input: string, init?: RequestInit): Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
}

interface SessionEnvelope {
  success: boolean;
  data?: PortalSession;
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

export function routeForSession(
  requestedSurface: PortalSurface,
  session: Pick<PortalSession, 'roles' | 'permissions'>,
): AuthRoute {
  const hasAdminWorkspace = session.permissions.includes('onboarding_cases.read')
    || session.permissions.includes('roles.assign');
  const isBorrower = session.roles.includes('sme_borrower');
  const isInvestor = session.roles.includes('investor');

  if (requestedSurface === 'admin' && hasAdminWorkspace) {
    return session.permissions.includes('onboarding_cases.read')
      ? { surface: 'admin', path: '/admin/onboarding' }
      : { surface: 'admin', path: '/admin/role-approvals' };
  }
  if (requestedSurface === 'borrower' && isBorrower) {
    return { surface: 'borrower', path: '/portal' };
  }
  if (requestedSurface === 'investor' && isInvestor) {
    return { surface: 'investor', path: '/portal' };
  }
  if (hasAdminWorkspace) {
    return session.permissions.includes('onboarding_cases.read')
      ? { surface: 'admin', path: '/admin/onboarding' }
      : { surface: 'admin', path: '/admin/role-approvals' };
  }
  if (isBorrower) return { surface: 'borrower', path: '/portal' };
  return { surface: 'investor', path: '/portal' };
}

export async function resolveAuthenticatedRoute(
  requestedSurface: PortalSurface,
  fetcher: FetchLike = fetch,
): Promise<AuthRoute | null> {
  try {
    const contextPath = requestedSurface === 'admin'
      ? '/v1/admin/session-context'
      : '/v1/session-context';
    const response = await fetcher(`${apiBaseUrl()}${contextPath}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const envelope = await response.json() as SessionEnvelope;
    if (!envelope.success || !envelope.data) return null;
    return routeForSession(requestedSurface, envelope.data);
  } catch {
    return null;
  }
}
