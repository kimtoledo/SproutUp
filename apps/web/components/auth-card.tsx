'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Building2, TrendingUp } from 'lucide-react';
import {
  registerWithEmail,
  signInWithEmail,
  type RegistrationIntent,
} from '@/lib/auth-client';

export function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<RegistrationIntent>('borrower');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const submittedIntent = form.get('registrationIntent');
    const result = mode === 'register'
      ? await registerWithEmail({
          name: String(form.get('name') ?? ''),
          email,
          password,
          registrationIntent:
            submittedIntent === 'borrower' || submittedIntent === 'investor'
              ? submittedIntent
              : intent,
        })
      : await signInWithEmail({ email, password });
    if (result.ok) {
      router.push('/portal');
      router.refresh();
      return;
    }
    setMessage(result.message ?? 'The request could not be completed.');
    setPending(false);
  }

  const registering = mode === 'register';
  return (
    <div className="auth-card">
      <div className="auth-heading">
        <p className="eyebrow">{registering ? 'Join the controlled pilot' : 'Welcome back'}</p>
        <h1>{registering ? 'Create your SproutUp account.' : 'Sign in to SproutUp.'}</h1>
        <p>
          {registering
            ? 'Choose your primary journey. Your role is verified by the server and can be changed later only through controlled access.'
            : 'Continue to your secure borrower or investor journey.'}
        </p>
      </div>

      <form className="auth-form" onSubmit={submit} noValidate>
        {registering ? (
          <fieldset className="intent-picker">
            <legend>I am joining as</legend>
            <label className={`intent-option${intent === 'borrower' ? ' is-selected' : ''}`}>
              <input
                checked={intent === 'borrower'}
                name="registrationIntent"
                onChange={() => setIntent('borrower')}
                type="radio"
                value="borrower"
              />
              <Building2 aria-hidden="true" size={20} />
              <span><strong>SME borrower</strong><small>Seek responsible growth capital</small></span>
            </label>
            <label className={`intent-option${intent === 'investor' ? ' is-selected' : ''}`}>
              <input
                checked={intent === 'investor'}
                name="registrationIntent"
                onChange={() => setIntent('investor')}
                type="radio"
                value="investor"
              />
              <TrendingUp aria-hidden="true" size={20} />
              <span><strong>Investor</strong><small>Review structured opportunities</small></span>
            </label>
          </fieldset>
        ) : null}

        {registering ? (
          <label>
            Full name
            <input autoComplete="name" maxLength={120} minLength={2} name="name" required />
          </label>
        ) : null}
        <label>
          Email address
          <input autoComplete="email" inputMode="email" name="email" required type="email" />
        </label>
        <label>
          Password
          <input
            autoComplete={registering ? 'new-password' : 'current-password'}
            maxLength={128}
            minLength={registering ? 12 : undefined}
            name="password"
            required
            type="password"
          />
          {registering ? <small>12–128 characters. Use a password manager.</small> : null}
        </label>

        {message ? <p className="form-message" role="alert">{message}</p> : null}
        <button className="primary-action auth-submit" disabled={pending} type="submit">
          {pending ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          {!pending ? <ArrowRight aria-hidden="true" size={18} /> : null}
        </button>
      </form>

      <p className="auth-switch">
        {registering ? 'Already have an account?' : 'New to SproutUp?'}{' '}
        <Link href={registering ? '/login' : '/register'}>
          {registering ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </div>
  );
}
