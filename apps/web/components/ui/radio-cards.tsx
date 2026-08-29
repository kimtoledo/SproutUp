import type { ReactNode } from 'react';
import { cn } from './cn';

export interface RadioCardOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  icon?: ReactNode;
}

interface RadioCardsProps<T extends string> {
  name: string;
  legend: string;
  options: ReadonlyArray<RadioCardOption<T>>;
  value: T;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}

const columnClass: Record<1 | 2 | 3, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
};

/**
 * Single-choice card group backed by real radio inputs (visually hidden), so it
 * works without JavaScript, is keyboard-navigable, and posts its value on a
 * plain form submit.
 */
export function RadioCards<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: RadioCardsProps<T>) {
  return (
    <fieldset className="grid gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-semibold text-foreground">{legend}</legend>
      <div className={cn('grid grid-cols-1 gap-2', columnClass[columns])}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-left',
                'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
                selected
                  ? 'border-primary bg-success-subtle shadow-[inset_0_0_0_1px_#287a4b]'
                  : 'border-border-strong bg-surface-muted hover:border-primary',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.icon ? (
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-primary">
                  {option.icon}
                </span>
              ) : null}
              <span className="grid gap-1">
                <strong className="font-semibold text-foreground">{option.title}</strong>
                {option.description ? (
                  <span className="text-sm text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
