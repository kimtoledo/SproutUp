import type { ReactNode } from 'react';
import { cn } from './cn';

export function Card({
  as: Tag = 'div',
  className,
  children,
}: {
  as?: 'div' | 'section' | 'article' | 'li';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cn('rounded-xl border border-border bg-surface p-5 shadow-card', className)}>
      {children}
    </Tag>
  );
}

/** Elevated container for a whole workspace panel. */
export function Panel({
  as: Tag = 'section',
  className,
  children,
}: {
  as?: 'div' | 'section' | 'article';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        'rounded-2xl border border-border bg-surface p-5 shadow-panel sm:p-8',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
