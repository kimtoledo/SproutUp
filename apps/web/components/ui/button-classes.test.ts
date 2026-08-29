import { describe, expect, it } from 'vitest';
import { buttonClasses } from './button-classes';

describe('buttonClasses', () => {
  it('defaults to the primary medium recipe', () => {
    const result = buttonClasses();
    expect(result).toContain('bg-primary');
    expect(result).toContain('text-primary-foreground');
    expect(result).toContain('min-h-[44px]');
  });

  it('always includes a visible focus ring', () => {
    expect(buttonClasses({ variant: 'ghost' })).toContain('focus-visible:ring-ring');
  });

  it('selects the requested variant and size', () => {
    const result = buttonClasses({ variant: 'danger', size: 'lg' });
    expect(result).toContain('bg-danger');
    expect(result).toContain('min-h-[52px]');
    expect(result).not.toContain('bg-primary ');
  });

  it('adds a full-width class only when asked', () => {
    expect(buttonClasses({ fullWidth: true })).toContain('w-full');
    expect(buttonClasses()).not.toContain('w-full');
  });

  it('appends caller class names last so they win', () => {
    const result = buttonClasses({ className: 'mt-4 custom' });
    expect(result.endsWith('mt-4 custom')).toBe(true);
  });

  it('keeps disabled and aria-disabled styling in the base recipe', () => {
    const result = buttonClasses();
    expect(result).toContain('disabled:opacity-60');
    expect(result).toContain('aria-disabled:opacity-60');
  });
});
