import Link from 'next/link';
import type { ReactNode } from 'react';
import { Sprout } from 'lucide-react';
import { cn } from './cn';

/**
 * Top bar shared by the marketing, auth, portal, and admin surfaces. `brand`
 * defaults to "SproutUp"; `right` holds nav links / account actions.
 */
export function SiteHeader({
  brand = 'SproutUp',
  brandHref = '/',
  brandSuffix,
  right,
  wide = false,
}: {
  brand?: string;
  brandHref?: string;
  brandSuffix?: ReactNode;
  right?: ReactNode;
  wide?: boolean;
}) {
  return (
    <header className="border-b border-border/70">
      <div
        className={cn(
          'mx-auto flex items-center justify-between gap-4 px-5 py-5',
          wide ? 'max-w-content-wide' : 'max-w-content',
        )}
      >
        <Link
          href={brandHref}
          aria-label={`${brand} home`}
          className="inline-flex items-center gap-2.5 text-lg font-extrabold tracking-tight text-foreground no-underline"
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-[11px_11px_11px_3px] bg-primary text-primary-foreground shadow-card"
          >
            <Sprout size={18} />
          </span>
          <span className="flex flex-col leading-tight">
            {brand}
            {brandSuffix ? (
              <span className="text-xs font-semibold text-muted-foreground">{brandSuffix}</span>
            ) : null}
          </span>
        </Link>
        {right ? <nav className="flex items-center gap-4 text-sm">{right}</nav> : null}
      </div>
    </header>
  );
}
