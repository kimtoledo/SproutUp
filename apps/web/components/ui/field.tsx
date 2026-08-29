import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';
import { fieldWiring } from './field-wiring';

const controlBase =
  'w-full min-h-[44px] rounded-md border border-border-strong bg-surface px-3 py-2 text-sm ' +
  'text-foreground placeholder:text-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ' +
  'aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60';

interface FieldFrameProps {
  /** Control `name`; also seeds the generated id. */
  name: string;
  label: string;
  idPrefix?: string;
  description?: ReactNode;
  error?: ReactNode;
  /** Render-prop receiving the resolved a11y wiring for the control. */
  children: (wiring: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
  }) => ReactNode;
}

export function Field({ name, label, idPrefix, description, error, children }: FieldFrameProps) {
  const wiring = fieldWiring({
    name,
    idPrefix,
    hasDescription: Boolean(description),
    hasError: Boolean(error),
  });
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-semibold text-foreground" htmlFor={wiring.inputId}>
        {label}
      </label>
      {description ? (
        <p className="text-sm text-muted-foreground" id={wiring.descriptionId}>
          {description}
        </p>
      ) : null}
      {children({
        id: wiring.inputId,
        'aria-describedby': wiring.describedBy,
        'aria-invalid': wiring.ariaInvalid,
      })}
      {error ? (
        <p className="text-sm font-medium text-danger-strong" id={wiring.errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlBase, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlBase, 'min-h-[96px] resize-y', className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(controlBase, 'pr-9', className)} {...rest} />;
}
