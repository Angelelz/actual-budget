import { getSheetValue, isTrackingBudget } from '#server/budget/actions';
// @ts-strict-ignore
import * as db from '#server/db';
import * as monthUtils from '#shared/months';

const DEFAULT_HORIZON = 12;
const MIN_HORIZON = 1;
const MAX_HORIZON = 60;

function readHorizon(): number {
  const row = db.firstSync<Pick<db.DbPreference, 'value'>>(
    `SELECT value FROM preferences WHERE id = ?`,
    ['autoIncomeBudgetHorizonMonths'],
  );
  const parsed = row?.value ? parseInt(row.value, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_HORIZON;
  return Math.max(MIN_HORIZON, Math.min(MAX_HORIZON, parsed));
}

type AccountBalances = Record<string, number>;

type MonthSnapshot = {
  month: string;
  surplus: number;
  allocations: Record<string, number>;
  balances: AccountBalances;
  uncategorized: number;
};

export type DebtProjectionResult = {
  months: string[];
  startBalances: AccountBalances;
  snapshots: MonthSnapshot[];
  debtFreeMonth: Record<string, string | null>;
};

/**
 * Compute a forward-looking debt-payoff projection.
 *
 * For each month in the horizon:
 *   surplus = projected income - projected spend
 * (current month uses budget MINUS already-acc'd actuals; future months use
 * the full budget). The surplus is poured into the selected accounts in
 * priority order (snowball): account[0] is paid down to zero first, then
 * account[1], and so on. Leftover surplus is reported as `uncategorized`.
 *
 * Only currently-negative accounts have a payment cap (we stop at zero).
 * Selected accounts whose current balance is non-negative receive payments
 * with no cap (interpreted as savings).
 */
export async function computeDebtProjection({
  accountIds,
}: {
  accountIds: string[];
}): Promise<DebtProjectionResult> {
  if (!isTrackingBudget()) {
    return {
      months: [],
      startBalances: {},
      snapshots: [],
      debtFreeMonth: {},
    };
  }

  const horizon = readHorizon();
  const startMonth = monthUtils.currentMonth();
  const months = monthUtils.rangeInclusive(
    startMonth,
    monthUtils.addMonths(startMonth, horizon - 1),
  );

  const startBalances = await readAccountBalances(accountIds);
  const balances: AccountBalances = { ...startBalances };

  // Income / spend categories (cached once).
  const categories = await db.all<{
    id: string;
    is_income: 1 | 0;
    tombstone: 1 | 0;
  }>(`SELECT id, is_income, tombstone FROM categories WHERE tombstone = 0`);
  const incomeCats = categories.filter(c => c.is_income === 1).map(c => c.id);
  const spendCats = categories.filter(c => c.is_income === 0).map(c => c.id);

  const debtFreeMonth: Record<string, string | null> = {};
  for (const id of accountIds) debtFreeMonth[id] = null;

  const snapshots: MonthSnapshot[] = [];

  for (const month of months) {
    const surplus = await computeMonthSurplus({
      month,
      isCurrent: month === startMonth,
      incomeCats,
      spendCats,
    });

    const { allocations, uncategorized } = applySnowball({
      surplus,
      accountIds,
      balances,
    });

    // Snapshot post-allocation balances (clone so future mutations don't
    // alter prior snapshots).
    snapshots.push({
      month,
      surplus,
      allocations,
      balances: { ...balances },
      uncategorized,
    });

    // Track first month each previously-negative account hits >= 0.
    for (const id of accountIds) {
      if (
        debtFreeMonth[id] == null &&
        startBalances[id] < 0 &&
        balances[id] >= 0
      ) {
        debtFreeMonth[id] = month;
      }
    }
  }

  return { months, startBalances, snapshots, debtFreeMonth };
}

async function readAccountBalances(
  accountIds: string[],
): Promise<AccountBalances> {
  const balances: AccountBalances = {};
  for (const id of accountIds) {
    const row = await db.first<{ total: number | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE acct = ? AND tombstone = 0`,
      [id],
    );
    balances[id] = row?.total ?? 0;
  }
  return balances;
}

async function computeMonthSurplus({
  month,
  isCurrent,
  incomeCats,
  spendCats,
}: {
  month: string;
  isCurrent: boolean;
  incomeCats: string[];
  spendCats: string[];
}): Promise<number> {
  const sheet = monthUtils.sheetForMonth(month);

  let income = 0;
  for (const cat of incomeCats) {
    const budgeted = await getSheetValue(sheet, 'budget-' + cat);
    if (isCurrent) {
      // Income sum-amount is positive (deposits); remaining = budgeted - actual.
      const actual = await getSheetValue(sheet, 'sum-amount-' + cat);
      income += Math.max(0, budgeted - actual);
    } else {
      income += budgeted;
    }
  }

  let spend = 0;
  for (const cat of spendCats) {
    const budgeted = await getSheetValue(sheet, 'budget-' + cat);
    if (isCurrent) {
      // Spend sum-amount is negative; actual spent = -sum-amount.
      const actual = -(await getSheetValue(sheet, 'sum-amount-' + cat));
      spend += Math.max(0, budgeted - actual);
    } else {
      spend += budgeted;
    }
  }

  return income - spend;
}

export function applySnowball({
  surplus,
  accountIds,
  balances,
}: {
  surplus: number;
  accountIds: string[];
  balances: AccountBalances;
}): { allocations: Record<string, number>; uncategorized: number } {
  const allocations: Record<string, number> = {};
  for (const id of accountIds) allocations[id] = 0;

  if (surplus <= 0) {
    return { allocations, uncategorized: surplus < 0 ? surplus : 0 };
  }

  let remaining = surplus;
  for (const id of accountIds) {
    if (remaining <= 0) break;
    const balance = balances[id] ?? 0;
    if (balance >= 0) {
      // Non-debt: skip (would otherwise inflate a positive balance).
      continue;
    }
    // Debt: pay up to abs(balance).
    const payment = Math.min(remaining, -balance);
    allocations[id] = payment;
    balances[id] = balance + payment;
    remaining -= payment;
  }

  return { allocations, uncategorized: remaining };
}
