'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Building2, TrendingUp } from 'lucide-react';
import { Alert, Button, Field, Input, RadioCards } from '@/components/ui';
import {
  registerWithEmail,
  signInWithEmail,
  type RegistrationIntent,
} from '@/lib/auth-client';

export function AuthCard({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const registering = mode === 'register';
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
    const result = registering
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

  return (
    <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-7 shadow-panel sm:p-12">
      <div className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
          {registering ? 'Join the controlled pilot' : 'Welcome back'}
        </p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {registering ? 'Create your SproutUp account.' : 'Sign in to SproutUp.'}
        </h1>
        <p className="text-muted-foreground">
          {registering
            ? 'Choose your primary journey. Your role is verified by the server and can be changed later only through controlled access.'
            : 'Continue to your secure borrower or investor journey.'}
        </p>
      </div>

      <form className="mt-8 grid gap-5" onSubmit={submit} noValidate>
        {registering ? (
          <RadioCards
            name="registrationIntent"
            legend="I am joining as"
            value={intent}
            onChange={setIntent}
            options={[
              {
                value: 'borrower',
                title: 'SME borrower',
                description: 'Seek responsible growth capital',
                icon: <Building2 size={20} />,
              },
              {
                value: 'investor',
                title: 'Investor',
                description: 'Review structured opportunities',
                icon: <TrendingUp size={20} />,
              },
            ]}
          />
        ) : null}

        {registering ? (
          <Field name="name" idPrefix={mode} label="Full name">
            {(wiring) => (
              <Input autoComplete="name" maxLength={120} minLength={2} name="name" required {...wiring} />
            )}
          </Field>
        ) : null}

        <Field name="email" idPrefix={mode} label="Email address">
          {(wiring) => (
            <Input
              autoComplete="email"
              inputMode="email"
              name="email"
              required
              type="email"
              {...wiring}
            />
          )}
        </Field>

        <Field
          name="password"
          idPrefix={mode}
          label="Password"
          description={registering ? '12–128 characters. Use a password manager.' : undefined}
        >
          {(wiring) => (
            <Input
              autoComplete={registering ? 'new-password' : 'current-password'}
              maxLength={128}
              minLength={registering ? 12 : undefined}
              name="password"
              required
              type="password"
              {...wiring}
            />
          )}
        </Field>

        {message ? <Alert tone="danger">{message}</Alert> : null}

        <Button type="submit" size="lg" fullWidth disabled={pending} aria-disabled={pending}>
          {pending ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
          {!pending ? <ArrowRight aria-hidden="true" size={18} /> : null}
        </Button>
      </form>

      <p className="mt-6 text-center text-muted-foreground">
        {registering ? 'Already have an account?' : 'New to SproutUp?'}{' '}
        <Link
          href={registering ? '/login' : '/register'}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {registering ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </div>
  );
}
