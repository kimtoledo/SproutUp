// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RadioCards, type RadioCardOption } from './radio-cards';

const options: ReadonlyArray<RadioCardOption<'borrower' | 'investor'>> = [
  { value: 'borrower', title: 'SME borrower', description: 'Seek capital' },
  { value: 'investor', title: 'Investor', description: 'Review opportunities' },
];

function Harness() {
  const [value, setValue] = useState<'borrower' | 'investor'>('borrower');
  return (
    <RadioCards
      name="registrationIntent"
      legend="I am joining as"
      options={options}
      value={value}
      onChange={setValue}
    />
  );
}

describe('<RadioCards>', () => {
  it('is a real radio group with one option checked', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'I am joining as' });
    expect(group).toBeInTheDocument();
    const borrower = screen.getByRole('radio', { name: /SME borrower/ });
    const investor = screen.getByRole('radio', { name: /Investor/ });
    expect(borrower).toBeChecked();
    expect(investor).not.toBeChecked();
  });

  it('submits its value under the given name (works without JS-built widgets)', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: /SME borrower/ })).toHaveAttribute(
      'name',
      'registrationIntent',
    );
  });

  it('moves the selection when another option is chosen', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Investor/ }));
    expect(screen.getByRole('radio', { name: /Investor/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /SME borrower/ })).not.toBeChecked();
  });
});
