import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWithEmail, signInAdminWithEmail, signInWithEmail, signOutAdmin } from './auth-client';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('web authentication client', () => {
  it('normalizes registration identity and calls the API with cookie credentials', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test/');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(registerWithEmail({
      name: '  Pilot Borrower  ',
      email: '  BORROWER@EXAMPLE.COM ',
      password: 'correct horse battery staple',
      registrationIntent: 'borrower',
    }, fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/auth/sign-up/email',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          name: 'Pilot Borrower',
          email: 'borrower@example.com',
          password: 'correct horse battery staple',
          registrationIntent: 'borrower',
        }),
      }),
    );
  });

  it('rejects invalid registration values before network access', async () => {
    const fetcher = vi.fn();
    await expect(registerWithEmail({
      name: 'P',
      email: 'not-an-email',
      password: 'short',
      registrationIntent: 'investor',
    }, fetcher)).resolves.toMatchObject({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses a non-enumerating sign-in error and a distinct rate-limit message', async () => {
    const denied = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const limited = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(signInWithEmail({ email: 'user@example.com', password: 'wrong' }, denied))
      .resolves.toEqual({ ok: false, message: 'The email or password was not accepted.' });
    await expect(signInWithEmail({ email: 'user@example.com', password: 'wrong' }, limited))
      .resolves.toEqual({
        ok: false,
        message: 'Too many attempts. Please wait a minute and try again.',
      });
  });

  it('returns a stable availability message for network failures', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('connection details must not leak'));
    await expect(signInWithEmail({ email: 'user@example.com', password: 'secret' }, fetcher))
      .resolves.toEqual({
        ok: false,
        message: 'SproutUp is temporarily unavailable. Please try again.',
      });
  });

  it('uses the isolated administrator sign-in namespace', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.sproutup.test');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(signInAdminWithEmail({
      email: '  ADMIN@SPROUTUP.PH ',
      password: 'correct horse battery staple',
    }, fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.sproutup.test/v1/auth/admin/sign-in/email',
      expect.objectContaining({
        credentials: 'include',
        body: JSON.stringify({
          email: 'admin@sproutup.ph',
          password: 'correct horse battery staple',
        }),
      }),
    );
  });

  it('signs out only through the administrator namespace', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await signOutAdmin(fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/auth/admin/sign-out',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });
});
