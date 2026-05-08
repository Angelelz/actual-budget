import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import * as sheet from '#server/sheet';

import {
  carryOverFromPrevious,
  carryOverFromPreviousMonth,
  getSheetValue,
  setBudget,
  setLongTerm,
  setLongTermMonth,
} from './actions';
import * as budget from './base';

async function setupCategories() {
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
  await db.insertCategory({
    id: 'gas',
    name: 'Gas',
    cat_group: 'spend-group',
    is_income: 0,
  });
}

async function setHorizon(months: number) {
  await db.update('preferences', {
    id: 'autoIncomeBudgetHorizonMonths',
    value: String(months),
  });
}

async function readBudget(category: string, month: string) {
  return getSheetValue(`budget${month.replace('-', '')}`, 'budget-' + category);
}

describe('setLongTerm', () => {
  beforeEach(global.emptyDatabase());
  afterEach(global.emptyDatabase());

  it('copies a spend cell forward by horizon-1 months', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 200000,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
      '2024-05',
      '2024-06',
    ]);
    await setHorizon(4);
    await sheet.waitOnSpreadsheet();

    await setLongTerm({ category: 'groceries', month: '2024-01' });
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('groceries', '2024-01')).toBe(200000);
    expect(await readBudget('groceries', '2024-02')).toBe(200000);
    expect(await readBudget('groceries', '2024-03')).toBe(200000);
    expect(await readBudget('groceries', '2024-04')).toBe(200000);
    // Beyond horizon - 1 untouched.
    expect(await readBudget('groceries', '2024-05')).toBe(0);
  });

  it('skips income categories', async () => {
    await setupCategories();
    await setBudget({
      category: 'income-cat',
      month: '2024-01',
      amount: 500000,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02', '2024-03']);
    await setHorizon(3);
    await sheet.waitOnSpreadsheet();

    await setLongTerm({ category: 'income-cat', month: '2024-01' });
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('income-cat', '2024-02')).toBe(0);
    expect(await readBudget('income-cat', '2024-03')).toBe(0);
  });

  it('overwrites existing future values', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 100000,
    });
    await setBudget({
      category: 'groceries',
      month: '2024-02',
      amount: 999999,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02', '2024-03']);
    await setHorizon(3);
    await sheet.waitOnSpreadsheet();

    await setLongTerm({ category: 'groceries', month: '2024-01' });
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('groceries', '2024-02')).toBe(100000);
    expect(await readBudget('groceries', '2024-03')).toBe(100000);
  });
});

describe('setLongTermMonth', () => {
  beforeEach(global.emptyDatabase());
  afterEach(global.emptyDatabase());

  it('copies all spend categories forward and skips income', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 200000,
    });
    await setBudget({ category: 'gas', month: '2024-01', amount: 60000 });
    await setBudget({
      category: 'income-cat',
      month: '2024-01',
      amount: 500000,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02', '2024-03']);
    await setHorizon(3);
    await sheet.waitOnSpreadsheet();

    await setLongTermMonth({ month: '2024-01' });
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('groceries', '2024-02')).toBe(200000);
    expect(await readBudget('groceries', '2024-03')).toBe(200000);
    expect(await readBudget('gas', '2024-02')).toBe(60000);
    expect(await readBudget('gas', '2024-03')).toBe(60000);
    expect(await readBudget('income-cat', '2024-02')).toBe(0);
    expect(await readBudget('income-cat', '2024-03')).toBe(0);
  });
});

describe('carryOverFromPrevious', () => {
  beforeEach(global.emptyDatabase());
  afterEach(global.emptyDatabase());

  async function seedPrevMonthSpend(amount: number) {
    // Fake a previous-month transaction so sum-amount is set.
    await db.insertAccount({ id: 'acct1', name: 'Checking', offbudget: 0 });
    await db.insertPayee({ id: 'payee1', name: 'Store' });
    await db.insertTransaction({
      id: 't1',
      account: 'acct1',
      category: 'groceries',
      amount, // negative for spending
      date: '2024-01-15',
    });
  }

  it('adds positive savings to current month budget', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 200000,
    });
    await setBudget({
      category: 'groceries',
      month: '2024-02',
      amount: 200000,
    });
    await seedPrevMonthSpend(-180000); // spent $1,800
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02']);
    await sheet.waitOnSpreadsheet();

    await carryOverFromPrevious({ category: 'groceries', month: '2024-02' });
    await sheet.waitOnSpreadsheet();

    // 200000 + (200000 + (-180000)) = 220000
    expect(await readBudget('groceries', '2024-02')).toBe(220000);
  });

  it('reduces current budget when last month was overspent', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 200000,
    });
    await setBudget({
      category: 'groceries',
      month: '2024-02',
      amount: 200000,
    });
    await seedPrevMonthSpend(-230000); // spent $2,300, $300 over
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02']);
    await sheet.waitOnSpreadsheet();

    await carryOverFromPrevious({ category: 'groceries', month: '2024-02' });
    await sheet.waitOnSpreadsheet();

    // 200000 + (200000 + (-230000)) = 170000
    expect(await readBudget('groceries', '2024-02')).toBe(170000);
  });

  it('skips income categories', async () => {
    await setupCategories();
    await setBudget({
      category: 'income-cat',
      month: '2024-01',
      amount: 500000,
    });
    await setBudget({
      category: 'income-cat',
      month: '2024-02',
      amount: 500000,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02']);
    await sheet.waitOnSpreadsheet();

    await carryOverFromPrevious({ category: 'income-cat', month: '2024-02' });
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('income-cat', '2024-02')).toBe(500000);
  });
});

describe('carryOverFromPreviousMonth', () => {
  beforeEach(global.emptyDatabase());
  afterEach(global.emptyDatabase());

  it('applies carry-over to all spend categories', async () => {
    await setupCategories();
    await setBudget({
      category: 'groceries',
      month: '2024-01',
      amount: 200000,
    });
    await setBudget({ category: 'gas', month: '2024-01', amount: 60000 });
    await setBudget({
      category: 'groceries',
      month: '2024-02',
      amount: 200000,
    });
    await setBudget({ category: 'gas', month: '2024-02', amount: 60000 });
    await db.insertAccount({ id: 'acct1', name: 'Checking', offbudget: 0 });
    await db.insertPayee({ id: 'payee1', name: 'Store' });
    await db.insertTransaction({
      id: 't1',
      account: 'acct1',
      category: 'groceries',
      amount: -180000,
      date: '2024-01-15',
    });
    await db.insertTransaction({
      id: 't2',
      account: 'acct1',
      category: 'gas',
      amount: -50000,
      date: '2024-01-20',
    });
    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2024-01', '2024-02']);
    await sheet.waitOnSpreadsheet();

    await carryOverFromPreviousMonth({ month: '2024-02' });
    await sheet.waitOnSpreadsheet();

    // groceries: 200000 + (200000 - 180000) = 220000
    expect(await readBudget('groceries', '2024-02')).toBe(220000);
    // gas: 60000 + (60000 - 50000) = 70000
    expect(await readBudget('gas', '2024-02')).toBe(70000);
  });
});
