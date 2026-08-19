import { describe, expect, it } from 'vitest';
import { product } from './product';

describe('product metadata', () => {
  it('uses the approved SproutUp name', () => {
    expect(product.name).toBe('SproutUp');
  });
});
