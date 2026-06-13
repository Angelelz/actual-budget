import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { createSchedule } from '#server/schedules/app';
import * as sheet from '#server/sheet';
import { loadRules } from '#server/transactions/transaction-rules';

import { getSheetValue } from './actions';
import {
  getAutoManagedIncomeCategoryIds,
  recomputeAutoIncomeBudgets,
} from './auto-income';
import * as budget from './base';

// Characterization tests for the schedule-driven auto-income budgeting feature.
// These pin the behavior of the server-side orchestration (recompute +
// category discovery) before the fork's custom code is refactored into seams.

type ScheduleConditionInput = { op: string; field: string; value: unknown };

// `createSchedule` is not strict-typed upstream (its `conditions` parameter
// defaults to `never[]`), so funnel every call through one typed bridge rather
// than scattering casts. This is the single point that touches the loose API.
function makeSchedule(arg: {
  schedule?: { auto_budget_category?: string | null };
  conditions: ScheduleConditionInput[];
}): Promise<string> {
  return createSchedule(arg as unknown as Parameters<typeof createSchedule>[0]);
}

async function insertIncomeCategory(id = 'income-cat') {
  await db.insertCategoryGroup({
    id: 'income-group',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategory({
    id,
    name: 'Salary',
    cat_group: 'income-group',
    is_income: 1,
  });
}

async function createAutoBudgetSchedule({
  category,
  amount,
  startDate,
}: {
  category: string;
  amount: number;
  startDate: string;
}) {
  const id = await makeSchedule({
    schedule: { auto_budget_category: category },
    conditions: [
      {
        op: 'is',
        field: 'date',
        value: {
          start: startDate,
          frequency: 'monthly',
          patterns: [],
          skipWeekend: false,
        },
      },
      { op: 'is', field: 'amount', value: amount },
    ],
  });

  // The schedule's computed `_amount`/`_date` fields are materialized from the
  // rule conditions via `schedules_json_paths`, which the schedules app
  // populates from its `trackJSONPaths` service. That service doesn't start in
  // a unit test, so replicate its `onRuleUpdate` logic here.
  const sched = db.firstSync<{ rule: string }>(
    `SELECT rule FROM schedules WHERE id = ?`,
    [id],
  );
  if (!sched) {
    throw new Error('schedule row not found after creation');
  }
  const rule = db.firstSync<{ conditions: string }>(
    `SELECT conditions FROM rules WHERE id = ?`,
    [sched.rule],
  );
  if (!rule) {
    throw new Error('rule row not found for schedule');
  }
  const conditions: ScheduleConditionInput[] = JSON.parse(rule.conditions);
  const amountIdx = conditions.findIndex(c => c.field === 'amount');
  const dateIdx = conditions.findIndex(c => c.field === 'date');
  if (amountIdx === -1 || dateIdx === -1) {
    throw new Error('expected amount and date conditions on the schedule');
  }
  // These schedules have no payee/account conditions, so those paths are NULL.
  db.runQuery(
    `INSERT OR REPLACE INTO schedules_json_paths
       (schedule_id, payee, account, amount, date)
     VALUES (?, NULL, NULL, ?, ?)`,
    [id, `$[${amountIdx}]`, `$[${dateIdx}]`],
  );

  return id;
}

function setPref(id: string, value: string) {
  db.runQuery(`INSERT OR REPLACE INTO preferences (id, value) VALUES (?, ?)`, [
    id,
    value,
  ]);
}

describe('getAutoManagedIncomeCategoryIds', () => {
  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
    await loadRules();
    await prefs.loadPrefs();
  });
  afterEach(global.emptyDatabase());

  it('returns the categories referenced by auto-budget schedules', async () => {
    await insertIncomeCategory('income-cat');

    await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 500000,
      startDate: '2024-01-01',
    });
    // A schedule with no auto_budget_category must not appear.
    await makeSchedule({
      conditions: [{ op: 'is', field: 'date', value: '2024-01-05' }],
    });

    const ids = await getAutoManagedIncomeCategoryIds();
    expect(ids).toEqual(['income-cat']);
  });

  it('deduplicates categories managed by multiple schedules', async () => {
    await insertIncomeCategory('income-cat');

    await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 100000,
      startDate: '2024-01-01',
    });
    await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 200000,
      startDate: '2024-01-15',
    });

    const ids = await getAutoManagedIncomeCategoryIds();
    expect(ids).toEqual(['income-cat']);
  });
});

describe('recomputeAutoIncomeBudgets', () => {
  // In tests `currentMonth()` resolves to `global.currentMonth` (default
  // '2017-01'); pin it so the projection window is deterministic.
  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
    await loadRules();
    await prefs.loadPrefs();
    global.currentMonth = '2017-01';
  });
  afterEach(() => {
    global.currentMonth = null;
    return global.emptyDatabase()();
  });

  async function readBudget(category: string, month: string) {
    return getSheetValue(
      `budget${month.replace('-', '')}`,
      'budget-' + category,
    );
  }

  it('writes the projected schedule amount into the managed category each month', async () => {
    setPref('budgetType', 'tracking');
    setPref('autoIncomeBudgetHorizonMonths', '3');
    await insertIncomeCategory('income-cat');
    await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 500000,
      startDate: '2017-01-01',
    });

    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2017-01', '2017-02', '2017-03']);
    await sheet.waitOnSpreadsheet();

    await recomputeAutoIncomeBudgets();
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('income-cat', '2017-01')).toBe(500000);
    expect(await readBudget('income-cat', '2017-02')).toBe(500000);
    expect(await readBudget('income-cat', '2017-03')).toBe(500000);
  });

  it('does nothing in envelope (non-tracking) budget mode', async () => {
    setPref('autoIncomeBudgetHorizonMonths', '3');
    await insertIncomeCategory('income-cat');
    await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 500000,
      startDate: '2017-01-01',
    });

    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2017-01', '2017-02', '2017-03']);
    await sheet.waitOnSpreadsheet();

    await recomputeAutoIncomeBudgets();
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('income-cat', '2017-01')).toBe(0);
  });

  it('clears months it managed previously but no longer manages', async () => {
    setPref('budgetType', 'tracking');
    setPref('autoIncomeBudgetHorizonMonths', '3');
    await insertIncomeCategory('income-cat');
    const scheduleId = await createAutoBudgetSchedule({
      category: 'income-cat',
      amount: 500000,
      startDate: '2017-01-01',
    });

    await sheet.loadSpreadsheet(db);
    await budget.createBudget(['2017-01', '2017-02', '2017-03']);
    await sheet.waitOnSpreadsheet();

    await recomputeAutoIncomeBudgets();
    await sheet.waitOnSpreadsheet();
    expect(await readBudget('income-cat', '2017-02')).toBe(500000);

    // Remove the schedule's managed category, then recompute: previously
    // managed future months should be reset to 0.
    await db.update('schedules', {
      id: scheduleId,
      auto_budget_category: null,
    });
    await recomputeAutoIncomeBudgets();
    await sheet.waitOnSpreadsheet();

    expect(await readBudget('income-cat', '2017-01')).toBe(0);
    expect(await readBudget('income-cat', '2017-02')).toBe(0);
    expect(await readBudget('income-cat', '2017-03')).toBe(0);
  });
});
