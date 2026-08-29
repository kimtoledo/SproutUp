import type { ReactNode } from 'react';
import { cn } from './cn';

export type AlertTone = 'info' | 'warning' | 'danger' | 'success';

const toneClasses: Record<AlertTone, string> = {
  info: 'border-l-info-strong bg-info-subtle text-info-strong',
  warning: 'border-l-warning bg-warning-subtle text-warning-strong',
  danger: 'border-l-danger bg-danger-subtle text-danger-strong',
  success: 'border-l-success bg-success-subtle text-success',
};

/**
 * Inline message block. `role` defaults to `alert` for danger/warning (so it is
 * announced) and `status` otherwise.
 */
export function Alert({
  tone = 'info',
  title,
  className,
  children,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border-l-4 px-4 py-3 text-sm leading-relaxed',
        toneClasses[tone],
        className,
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}
