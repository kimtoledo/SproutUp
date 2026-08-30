export type RegistrationIntent = 'borrower' | 'investor';

export interface AuthClientResult {
  ok: boolean;
  message?: string;
}

interface FetchLike {
  (input: string, init: RequestInit): Promise<Pick<Response, 'ok' | 'status'>>;
}

function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendAuthRequest(
  path: string,
  body: Record<string, unknown>,
  fetcher: FetchLike,
): Promise<AuthClientResult> {
  try {
    const response = await fetcher(`${apiBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    if (response.status === 429) {
      return { ok: false, message: 'Too many attempts. Please wait a minute and try again.' };
    }
    return {
      ok: false,
      message: path.includes('sign-in')
        ? 'The email or password was not accepted.'
        : 'We could not create that account. Check the details or use another email.',
    };
  } catch {
    return { ok: false, message: 'SproutUp is temporarily unavailable. Please try again.' };
  }
}

export async function registerWithEmail(
  input: { name: string; email: string; password: string; registrationIntent: RegistrationIntent },
  fetcher: FetchLike = fetch,
): Promise<AuthClientResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120) {
    return { ok: false, message: 'Enter your full name (2–120 characters).' };
  }
  if (!validEmail(email)) return { ok: false, message: 'Enter a valid email address.' };
  if (input.password.length < 12 || input.password.length > 128) {
    return { ok: false, message: 'Use a password between 12 and 128 characters.' };
  }
  return sendAuthRequest(`/v1/auth/${input.registrationIntent}/sign-up/email`, {
    name,
    email,
    password: input.password,
  }, fetcher);
}

export async function signInWithEmail(
  input: { email: string; password: string; accountType: RegistrationIntent },
  fetcher: FetchLike = fetch,
): Promise<AuthClientResult> {
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email) || input.password.length === 0) {
    return { ok: false, message: 'Enter your email and password.' };
  }
  return sendAuthRequest(`/v1/auth/${input.accountType}/sign-in/email`, {
    email,
    password: input.password,
  }, fetcher);
}

export async function signInAdminWithEmail(
  input: { email: string; password: string },
  fetcher: FetchLike = fetch,
): Promise<AuthClientResult> {
  const email = input.email.trim().toLowerCase();
  if (!validEmail(email) || input.password.length === 0) {
    return { ok: false, message: 'Enter your staff email and password.' };
  }
  return sendAuthRequest('/v1/auth/admin/sign-in/email', {
    email,
    password: input.password,
  }, fetcher);
}

export async function signOutAdmin(fetcher: FetchLike = fetch): Promise<void> {
  try {
    await fetcher(`${apiBaseUrl()}/v1/auth/admin/sign-out`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  } catch {
    // The next protected read remains authoritative if the request did not arrive.
  }
}
