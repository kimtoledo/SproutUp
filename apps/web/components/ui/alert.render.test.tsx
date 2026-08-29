// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './alert';

describe('<Alert>', () => {
  it('announces danger and warning messages via role="alert"', () => {
    const { rerender } = render(<Alert tone="danger">Something failed</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');

    rerender(<Alert tone="warning">Careful</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Careful');
  });

  it('uses role="status" for info and success (polite, not assertive)', () => {
    const { rerender } = render(<Alert tone="info">Heads up</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(<Alert tone="success">Saved</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('renders an optional title alongside the body', () => {
    render(
      <Alert tone="danger" title="Rejected">
        Open the history for the reason.
      </Alert>,
    );
    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('Rejected');
    expect(region).toHaveTextContent('Open the history for the reason.');
  });
});
