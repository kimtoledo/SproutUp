import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { ButtonLink, Card, SiteHeader } from '@/components/ui';
import { portalSurfaces, portalUrl, type PortalSurface } from '@/lib/portal-surface';

const surfaceIcons = {
  admin: ShieldCheck,
  borrower: Building2,
  investor: TrendingUp,
} as const;

export function SurfaceHome({ surface }: { surface: PortalSurface }) {
  const content = portalSurfaces[surface];
  const isMain = surface === 'main';

  return (
    <main className="min-h-[100dvh]">
      <SiteHeader
        brand={content.label}
        right={
          <>
            {isMain ? null : (
              <Link
                href="/login"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
            )}
            {content.registrationIntent ? (
              <ButtonLink href="/register" size="sm">
                Create account
              </ButtonLink>
            ) : null}
            {surface === 'admin' ? (
              <ButtonLink href="/login" size="sm">
                Staff access
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <section className="mx-auto grid max-w-content gap-12 px-5 py-16 md:grid-cols-[1.4fr_0.9fr] md:items-center md:py-24">
        <div className="grid gap-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            {content.eyebrow}
          </p>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            {content.headline}
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {content.description}
          </p>
          {!isMain ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ButtonLink href={surface === 'admin' ? '/login' : '/register'} size="lg">
                {surface === 'admin' ? 'Enter operations' : 'Start your journey'}
                <ArrowRight aria-hidden="true" size={18} />
              </ButtonLink>
              {surface !== 'admin' ? (
                <Link
                  href="/login"
                  className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                  I have an account
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>

        {isMain ? (
          <div className="grid gap-3" aria-label="Choose your SproutUp experience">
            {(['borrower', 'investor', 'admin'] as const).map((target) => {
              const Icon = surfaceIcons[target];
              const targetContent = portalSurfaces[target];
              return (
                <a
                  key={target}
                  href={portalUrl(target)}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 no-underline shadow-card transition-colors hover:border-primary"
                >
                  <Icon aria-hidden="true" size={22} className="shrink-0 text-primary" />
                  <span className="grid flex-1 gap-0.5">
                    <strong className="font-semibold text-foreground">{targetContent.label}</strong>
                    <small className="text-sm text-muted-foreground">{targetContent.eyebrow}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} className="shrink-0 text-muted-foreground" />
                </a>
              );
            })}
          </div>
        ) : (
          <Card className="grid gap-3">
            {surface === 'admin' ? (
              <ShieldCheck aria-hidden="true" size={34} className="text-primary" />
            ) : (
              <ChartNoAxesCombined aria-hidden="true" size={34} className="text-primary" />
            )}
            <p className="font-semibold">Built for this journey</p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {content.highlights.map((highlight) => (
                <li key={highlight} className="border-t border-border pt-2 first:border-0 first:pt-0">
                  {highlight}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section
        className="border-t border-border bg-surface-muted"
        aria-label="Experience highlights"
      >
        <div className="mx-auto grid max-w-content gap-4 px-5 py-14 sm:grid-cols-3">
          {content.highlights.map((highlight, index) => (
            <article key={highlight} className="grid gap-2">
              <span className="text-sm font-bold text-primary">0{index + 1}</span>
              <h2 className="text-lg font-semibold leading-snug">{highlight}</h2>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
