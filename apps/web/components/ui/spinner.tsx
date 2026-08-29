import { cn } from './cn';

/**
 * Accessible busy indicator. The visible ring is decorative; the label is
 * exposed to assistive tech via `role="status"`.
 */
export function Spinner({
  label = 'Loading…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-primary"
      />
      <span className="text-sm text-muted-foreground">{label}</span>
    </span>
  );
}
