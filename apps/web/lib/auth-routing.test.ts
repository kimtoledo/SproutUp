import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAuthenticatedRoute, routeForSession } from './auth-routing';

afterEach(() => vi.unstubAllEnvs());

const staffQueue = { accountType: 'admin' as const, permissions: ['onboarding_cases.read'] };
const staffApprovals = { accountType: 'admin' as const, permissions: ['roles.assign'] };
const borrower = { accountType: 'borrower' as const, permissions: ['borrower_onboarding.manage_own'] };
const investor = { accountType: 'investor' as const, permissions: ['investor_onboarding.manage_own'] };

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

  it('routes borrower and investor surfaces to the portal for matching account classes', () => {
    expect(routeForSession('borrower', borrower)).toEqual({ surface: 'borrower', path: '/portal' });
    expect(routeForSession('investor', investor)).toEqual({ surface: 'investor', path: '/portal' });
  });

  it('falls back to the account\'s real capability when the requested surface does not match', () => {
    // An investor landing on the admin surface with no staff permission.
    expect(routeForSession('admin', investor)).toEqual({ surface: 'investor', path: '/portal' });
    // Staff landing on the borrower surface remains in the admin boundary.
    expect(routeForSession('borrower', staffQueue)).toEqual({
      surface: 'admin',
      path: '/admin/onboarding',
    });
  });

  it('does not convert a customer into staff even if a permission payload is malformed', () => {
    const malformed = {
      accountType: 'investor' as const,
      permissions: ['onboarding_cases.read', 'investor_onboarding.manage_own'],
    };
    expect(routeForSession('admin', malformed)).toEqual({ surface: 'investor', path: '/portal' });
  });

  it('resolves investors through the isolated investor context endpoint', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test');
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: investor }),
    });
    await expect(resolveAuthenticatedRoute('investor', fetcher)).resolves.toEqual({
      surface: 'investor', path: '/portal',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/investor/session-context',
      expect.objectContaining({ credentials: 'include' }),
    );
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
