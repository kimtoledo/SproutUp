import type { Metadata } from 'next';
import { ButtonLink, SiteHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Offline | SproutUp' };

export default function OfflinePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader right={<span className="text-sm text-muted-foreground">Offline</span>} />
      <section className="mx-auto grid max-w-content place-items-start gap-4 px-5 py-20">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">No connection</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">You are offline.</h1>
        <p className="max-w-xl text-muted-foreground">
          SproutUp needs a connection to load your account, cases, and financial data securely.
          Reconnect and try again — nothing you were viewing was stored on this device.
        </p>
        <ButtonLink href="/">Retry from home</ButtonLink>
      </section>
    </main>
  );
}
