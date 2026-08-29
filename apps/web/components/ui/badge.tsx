import type { ReactNode } from 'react';
import { badgeToneClasses, statusTone, type BadgeTone } from './badge-tone';
import { cn } from './cn';

const shell =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize';

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn(shell, badgeToneClasses(tone), className)}>{children}</span>;
}

/** Badge whose tone is derived from a domain status string. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn(shell, badgeToneClasses(statusTone(status)), className)}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
