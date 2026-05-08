import { describe, expect, it } from 'vitest';

import { applySnowball } from './debt-projection';

describe('applySnowball', () => {
  it('returns zero allocations and no leftover when surplus is zero', () => {
    const balances = { a: -100, b: -200 };
    const r = applySnowball({ surplus: 0, accountIds: ['a', 'b'], balances });
    expect(r.allocations).toEqual({ a: 0, b: 0 });
    expect(r.uncategorized).toBe(0);
  });

  it('reports negative surplus as uncategorized and does not change balances', () => {
    const balances = { a: -100 };
    const r = applySnowball({
      surplus: -50,
      accountIds: ['a'],
      balances,
    });
    expect(r.allocations).toEqual({ a: 0 });
    expect(r.uncategorized).toBe(-50);
    expect(balances).toEqual({ a: -100 });
  });

  it('pours surplus into the first debt until it hits zero, then the next', () => {
    const balances = { a: -100, b: -200 };
    const r = applySnowball({ surplus: 250, accountIds: ['a', 'b'], balances });
    // a needed 100, b needed 200, total 300. We had 250, so a clears (100)
    // and b receives 150.
    expect(r.allocations).toEqual({ a: 100, b: 150 });
    expect(balances).toEqual({ a: 0, b: -50 });
    expect(r.uncategorized).toBe(0);
  });

  it('reports leftover when surplus exceeds total debt', () => {
    const balances = { a: -100, b: -50 };
    const r = applySnowball({ surplus: 200, accountIds: ['a', 'b'], balances });
    expect(r.allocations).toEqual({ a: 100, b: 50 });
    expect(r.uncategorized).toBe(50);
    expect(balances).toEqual({ a: 0, b: 0 });
  });

  it('skips non-debt accounts (positive or zero balance)', () => {
    const balances = { savings: 500, debt: -300 };
    const r = applySnowball({
      surplus: 200,
      accountIds: ['savings', 'debt'],
      balances,
    });
    // savings is non-debt -> 0 payment. debt receives all 200.
    expect(r.allocations).toEqual({ savings: 0, debt: 200 });
    expect(balances).toEqual({ savings: 500, debt: -100 });
    expect(r.uncategorized).toBe(0);
  });

  it('honors priority order even when later accounts have larger debt', () => {
    const balances = { small: -50, big: -1000 };
    const r = applySnowball({
      surplus: 300,
      accountIds: ['small', 'big'],
      balances,
    });
    // small clears (50), big takes the remaining 250.
    expect(r.allocations).toEqual({ small: 50, big: 250 });
    expect(balances).toEqual({ small: 0, big: -750 });
  });
});
