import { describe, expect, it } from 'vitest';
import { cartLineKey, itemCopper } from './shops-cart';

describe('shop cart', () => {
  it('splits a pack offer into a per-item copper price', () => {
    expect(itemCopper('15 sp for 10')).toBe(15);
    expect(itemCopper('2 gp 5 sp')).toBe(250);
    expect(itemCopper('—')).toBe(0);
  });

  it('keeps the same item from two shops on separate keys', () => {
    const row = { id: 12, name: 'Torch' };
    expect(cartLineKey('shop-a', row)).not.toBe(cartLineKey('shop-b', row));
  });
});
