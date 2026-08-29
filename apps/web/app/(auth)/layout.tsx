import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, SiteHeader } from '@/components/ui';

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="min-h-[100dvh]">
      <SiteHeader
        right={
          <Link
            href="/"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
        }
      />
      <section
        className="mx-auto grid min-h-[calc(100dvh-5.5rem)] w-full max-w-content place-items-start justify-center px-5 py-10 sm:py-16"
        aria-label="Account access"
      >
        <div className="w-full max-w-xl">
          <noscript>
            <Alert tone="warning" className="mb-6">
              SproutUp sign-in and registration need JavaScript enabled in your browser.
            </Alert>
          </noscript>
          {children}
        </div>
      </section>
    </main>
  );
}
