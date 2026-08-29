import { describe, expect, it } from 'vitest';
import { fieldWiring } from './field-wiring';

describe('fieldWiring', () => {
  it('derives a stable input id from the prefix and name', () => {
    expect(fieldWiring({ name: 'email' }).inputId).toBe('field-email');
    expect(fieldWiring({ name: 'email', idPrefix: 'register' }).inputId).toBe('register-email');
  });

  it('omits description and error ids when those slots are absent', () => {
    const wiring = fieldWiring({ name: 'email' });
    expect(wiring.descriptionId).toBeUndefined();
    expect(wiring.errorId).toBeUndefined();
    expect(wiring.describedBy).toBeUndefined();
    expect(wiring.ariaInvalid).toBeUndefined();
  });

  it('links only the present slots in describedBy, description first', () => {
    expect(fieldWiring({ name: 'pw', hasDescription: true }).describedBy).toBe('field-pw-description');
    expect(fieldWiring({ name: 'pw', hasError: true }).describedBy).toBe('field-pw-error');
    expect(fieldWiring({ name: 'pw', hasDescription: true, hasError: true }).describedBy).toBe(
      'field-pw-description field-pw-error',
    );
  });

  it('marks the control invalid only when an error is present', () => {
    expect(fieldWiring({ name: 'pw', hasError: true }).ariaInvalid).toBe(true);
    expect(fieldWiring({ name: 'pw', hasError: false }).ariaInvalid).toBeUndefined();
  });
});
