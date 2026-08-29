import { cn } from './cn';
import { stepStates } from './stepper-model';

/**
 * Horizontal progress stepper for multi-step flows (KYC profile, credit
 * application, …). Purely presentational — pass the active index in.
 */
export function Stepper({
  steps,
  currentIndex,
  className,
}: {
  steps: readonly string[];
  currentIndex: number;
  className?: string;
}) {
  const views = stepStates(steps, currentIndex);
  const current = views.find((v) => v.state === 'current');
  return (
    <ol
      className={cn('flex flex-wrap gap-x-4 gap-y-2', className)}
      aria-label={current ? `Step ${current.position} of ${steps.length}: ${current.label}` : undefined}
    >
      {views.map((view) => (
        <li key={view.label} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn(
              'grid h-6 w-6 place-items-center rounded-full border text-xs font-semibold',
              view.state === 'done' && 'border-primary bg-primary text-primary-foreground',
              view.state === 'current' && 'border-primary text-primary',
              view.state === 'upcoming' && 'border-border-strong text-muted-foreground',
            )}
          >
            {view.state === 'done' ? '✓' : view.position}
          </span>
          <span
            aria-current={view.state === 'current' ? 'step' : undefined}
            className={cn(
              view.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {view.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
