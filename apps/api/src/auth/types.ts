import type { AuthorizationContext } from '@sproutup/shared';

export interface BetterAuthSession {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface AuthServices {
  handler(request: Request): Promise<Response>;
  getSession(headers: Headers): Promise<BetterAuthSession | null>;
  resolveAuthorization(userId: string): Promise<AuthorizationContext | null>;
}
