import Link from 'next/link';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Building2, ShieldCheck, TrendingUp } from 'lucide-react';
import { Alert, Card, SiteHeader } from '@/components/ui';
import { portalSurfaces, surfaceFromHost } from '@/lib/portal-surface';

export default async function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  const surface = surfaceFromHost((await headers()).get('host'));
  const content = portalSurfaces[surface];
  const Icon = surface === 'admin' ? ShieldCheck : surface === 'investor' ? TrendingUp : Building2;

  return (
    <main className="min-h-[100dvh]">
      <SiteHeader
        brand={content.label}
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
        className="mx-auto grid min-h-[calc(100dvh-5.5rem)] w-full max-w-content gap-10 px-5 py-10 lg:grid-cols-[0.85fr_1fr] lg:items-center lg:py-16"
        aria-label="Account access"
      >
        <aside className="grid content-center gap-6 lg:pr-8">
          <Icon aria-hidden="true" size={38} className="text-primary" />
          <div className="grid gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{content.eyebrow}</p>
            <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{content.headline}</h2>
            <p className="leading-relaxed text-muted-foreground">{content.description}</p>
          </div>
          <Card className="grid gap-2">
            {content.highlights.map((highlight) => (
              <p key={highlight} className="border-t border-border pt-2 text-sm font-semibold first:border-0 first:pt-0">
                {highlight}
              </p>
            ))}
          </Card>
        </aside>
        <div className="w-full max-w-xl justify-self-end">
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
