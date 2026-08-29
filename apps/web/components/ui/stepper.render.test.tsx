// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from './stepper';

const steps = ['Profile', 'Documents', 'Declarations', 'Review'];

describe('<Stepper>', () => {
  it('marks the active step with aria-current="step"', () => {
    render(<Stepper steps={steps} currentIndex={2} />);
    const current = screen.getByText('Declarations');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Profile')).not.toHaveAttribute('aria-current');
  });

  it('summarises progress in the list label', () => {
    render(<Stepper steps={steps} currentIndex={1} />);
    expect(screen.getByRole('list')).toHaveAccessibleName('Step 2 of 4: Documents');
  });

  it('renders every step label', () => {
    render(<Stepper steps={steps} currentIndex={0} />);
    for (const label of steps) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
