import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthenticatedRoute, routeForSession } from './auth-routing';

afterEach(() => vi.unstubAllEnvs());

const staffQueue = { roles: ['compliance_officer'], permissions: ['onboarding_cases.read'] };
const staffApprovals = { roles: ['super_admin'], permissions: ['roles.assign'] };
const borrower = { roles: ['sme_borrower'], permissions: ['borrower_onboarding.manage_own'] };
const investor = { roles: ['investor'], permissions: ['investor_onboarding.manage_own'] };

describe('routeForSession', () => {
  it('sends a compliance reviewer to the onboarding queue for the admin surface', () => {
    expect(routeForSession('admin', staffQueue)).toEqual({
      surface: 'admin',
      path: '/admin/onboarding',
    });
  });

  it('sends a roles.assign-only admin to the role-approvals workspace', () => {
    expect(routeForSession('admin', staffApprovals)).toEqual({
      surface: 'admin',
      path: '/admin/role-approvals',
    });
  });

  it('routes borrower and investor surfaces to the portal for matching roles', () => {
    expect(routeForSession('borrower', borrower)).toEqual({ surface: 'borrower', path: '/portal' });
    expect(routeForSession('investor', investor)).toEqual({ surface: 'investor', path: '/portal' });
  });

  it('falls back to the account\'s real capability when the requested surface does not match', () => {
    // An investor landing on the admin surface with no staff permission.
    expect(routeForSession('admin', investor)).toEqual({ surface: 'investor', path: '/portal' });
    // Staff landing on the borrower surface without a borrower role.
    expect(routeForSession('borrower', staffQueue)).toEqual({
      surface: 'admin',
      path: '/admin/onboarding',
    });
  });

  it('prefers the admin workspace when an account holds both staff and customer roles', () => {
    const dual = {
      roles: ['compliance_officer', 'investor'],
      permissions: ['onboarding_cases.read', 'investor_onboarding.manage_own'],
    };
    expect(routeForSession('investor', dual)).toEqual({ surface: 'investor', path: '/portal' });
    expect(routeForSession('main', dual)).toEqual({ surface: 'admin', path: '/admin/onboarding' });
  });

  it('resolves admin sessions through the isolated admin context endpoint', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: staffQueue }),
    });
    await expect(resolveAuthenticatedRoute('admin', fetcher)).resolves.toEqual({
      surface: 'admin',
      path: '/admin/onboarding',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/admin/session-context',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
