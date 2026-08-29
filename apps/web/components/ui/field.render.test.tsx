// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field, Input } from './field';

describe('<Field>', () => {
  it('associates the label with the control', () => {
    render(
      <Field name="email" label="Email address">
        {(wiring) => <Input type="email" {...wiring} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email address');
    expect(input).toHaveAttribute('id', 'field-email');
  });

  it('links a description via aria-describedby', () => {
    render(
      <Field name="password" label="Password" description="12–128 characters">
        {(wiring) => <Input type="password" {...wiring} />}
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAccessibleDescription('12–128 characters');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and links the error text when an error is present', () => {
    render(
      <Field name="email" label="Email address" error="That email is already registered">
        {(wiring) => <Input type="email" {...wiring} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email address');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('That email is already registered');
    expect(screen.getByRole('alert')).toHaveTextContent('already registered');
  });

  it('uses the id prefix so two fields with the same name on one page do not collide', () => {
    render(
      <>
        <Field name="email" idPrefix="login" label="Login email">
          {(wiring) => <Input {...wiring} />}
        </Field>
        <Field name="email" idPrefix="register" label="Register email">
          {(wiring) => <Input {...wiring} />}
        </Field>
      </>,
    );
    expect(screen.getByLabelText('Login email')).toHaveAttribute('id', 'login-email');
    expect(screen.getByLabelText('Register email')).toHaveAttribute('id', 'register-email');
  });
});
