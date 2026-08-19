import { describe, expect, it, vi } from 'vitest';
import { loadOwnSessions, revokeOwnSession } from './session-client';

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('session client', () => {
  it('loads own sessions with the current session flagged', async () => {
    const sessions = [
      {
        id: 'session-1',
        createdAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2026-08-26T00:00:00.000Z',
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0',
        current: true,
      },
      {
        id: 'session-2',
        createdAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-17T00:00:00.000Z',
        ipAddress: null,
        userAgent: null,
        current: false,
      },
    ];
    const fetcher = vi.fn().mockResolvedValue(response(200, { success: true, data: sessions }));
    await expect(loadOwnSessions(fetcher)).resolves.toEqual({ ok: true, sessions });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/sessions',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('reports unauthenticated without treating it as a generic failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(401, {
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    }));
    await expect(loadOwnSessions(fetcher)).resolves.toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('revokes a session by ID with cookie credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(204, null));
    await expect(revokeOwnSession('session-2', fetcher)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:3001/v1/sessions/session-2',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });

  it('maps a missing session to a bounded message without exposing server text', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(404, {
      success: false,
      error: { code: 'NOT_FOUND', message: 'internal detail ignored' },
    }));
    await expect(revokeOwnSession('session-2', fetcher)).resolves.toEqual({
      ok: false,
      message: 'That session is already signed out.',
    });
  });
});
