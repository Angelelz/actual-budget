import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setBudget } from '#server/budget/actions';
import * as budget from '#server/budget/base';
import * as db from '#server/db';
import * as sheet from '#server/sheet';

import { applySnowball, computeDebtProjection } from './debt-projection';

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

// Characterization test for the end-to-end debt projection handler (the fork's
// debt-projection report). Locks the surplus + snowball + debt-free tracking
// orchestration before the feature is touched during the seam refactor.
describe('computeDebtProjection (integration)', () => {
  // In tests `currentMonth()` resolves to `global.currentMonth` (default
  // '2017-01'); pin it so the horizon window is deterministic.
  beforeEach(async () => {
    await global.emptyDatabase()();
    global.currentMonth = '2017-01';
    db.runQuery(
      `INSERT OR REPLACE INTO preferences (id, value) VALUES ('budgetType', 'tracking')`,
    );
    db.runQuery(
      `INSERT OR REPLACE INTO preferences (id, value) VALUES ('autoIncomeBudgetHorizonMonths', '3')`,
    );
  });
  afterEach(() => {
    global.currentMonth = null;
    return global.emptyDatabase()();
  });

  it('returns an empty result outside of tracking budget mode', async () => {
    db.runQuery(
      `INSERT OR REPLACE INTO preferences (id, value) VALUES ('budgetType', 'envelope')`,
    );
    const result = await computeDebtProjection({ accountIds: ['acct1'] });
    expect(result).toEqual({
      months: [],
      startBalances: {},
      snapshots: [],
      debtFreeMonth: {},
    });
  });

  it('pours each month surplus into the debt and reports when it is paid off', async () => {
    await db.insertCategoryGroup({
      id: 'income-group',
      name: 'Income',
      is_income: 1,
    });
    await db.insertCategory({
      id: 'income-cat',
      name: 'Salary',
      cat_group: 'income-group',
      is_income: 1,
    });
    await db.insertCategoryGroup({
      id: 'spend-group',
      name: 'Spend',
      is_income: 0,
    });
    await db.insertCategory({
      id: 'groceries',
      name: 'Groceries',
      cat_group: 'spend-group',
      is_income: 0,
    });

    // A credit-card account with a $1,000 debt established before the horizon
    // (uncategorized, so it doesn't affect current-month actuals).
    await db.insertAccount({ id: 'card', name: 'Card', offbudget: 0 });
    await db.insertPayee({ id: 'payee1', name: 'Opening' });
    await db.insertTransaction({
      id: 'opening',
      account: 'card',
      amount: -100000,
      date: '2016-12-01',
    });

    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2017-01', '2017-02', '2017-03']);

    // $3,000 budgeted income, $1,000 budgeted spend => $2,000 surplus / month.
    for (const month of ['2017-01', '2017-02', '2017-03']) {
      await setBudget({ category: 'income-cat', month, amount: 300000 });
      await setBudget({ category: 'groceries', month, amount: 100000 });
    }
    await sheet.waitOnSpreadsheet();

    const result = await computeDebtProjection({ accountIds: ['card'] });

    expect(result.months).toEqual(['2017-01', '2017-02', '2017-03']);
    expect(result.startBalances).toEqual({ card: -100000 });

    // Month 1: surplus 200000, debt 100000 -> pays it off, 100000 left over.
    expect(result.snapshots[0].surplus).toBe(200000);
    expect(result.snapshots[0].allocations).toEqual({ card: 100000 });
    expect(result.snapshots[0].balances).toEqual({ card: 0 });
    expect(result.snapshots[0].uncategorized).toBe(100000);

    // Month 2: debt already cleared -> nothing allocated, all surplus leftover.
    expect(result.snapshots[1].allocations).toEqual({ card: 0 });
    expect(result.snapshots[1].uncategorized).toBe(200000);

    // Debt-free in the first month.
    expect(result.debtFreeMonth).toEqual({ card: '2017-01' });
  });
});
