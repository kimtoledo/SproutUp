// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button, ButtonLink } from './button';

describe('<Button>', () => {
  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('honours an explicit type', () => {
    render(<Button type="submit">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'submit');
  });

  it('fires onClick when enabled and not when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Tap</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Tap
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('<ButtonLink>', () => {
  it('renders an internal href as a link', () => {
    render(<ButtonLink href="/portal">Portal</ButtonLink>);
    expect(screen.getByRole('link', { name: 'Portal' })).toHaveAttribute('href', '/portal');
  });

  it('renders an external href as a plain anchor', () => {
    render(<ButtonLink href="https://example.com">Out</ButtonLink>);
    expect(screen.getByRole('link', { name: 'Out' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });
});
