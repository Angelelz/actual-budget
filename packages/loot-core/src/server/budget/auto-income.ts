// @ts-strict-ignore
import * as d from 'date-fns';

import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import * as prefs from '#server/prefs';
import { batchMessages } from '#server/sync';
import { RSchedule } from '#server/util/rschedule';
import {
  addMonths,
  currentMonth,
  monthFromDate,
  parseDate,
} from '#shared/months';
import { q } from '#shared/query';
import {
  getDateWithSkippedWeekend,
  getScheduledAmount,
  recurConfigToRSchedule,
} from '#shared/schedules';
import type { RuleConditionEntity, ScheduleEntity } from '#types/models';

import { isTrackingBudget, setBudget } from './actions';

const DEFAULT_HORIZON_MONTHS = 12;
export const MIN_HORIZON_MONTHS = 1;
export const MAX_HORIZON_MONTHS = 60;

type MonthCents = Record<string, number>;
type Targets = Map<string, MonthCents>;
type SerializedTargets = Record<string, string[]>;

function readHorizon(): number {
  const row = db.firstSync<Pick<db.DbPreference, 'value'>>(
    `SELECT value FROM preferences WHERE id = ?`,
    ['autoIncomeBudgetHorizonMonths'],
  );
  const raw = row?.value;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HORIZON_MONTHS;
  }
  return Math.max(MIN_HORIZON_MONTHS, Math.min(MAX_HORIZON_MONTHS, parsed));
}

function readLastTargets(): SerializedTargets {
  const row = db.firstSync<Pick<db.DbPreference, 'value'>>(
    `SELECT value FROM preferences WHERE id = ?`,
    ['autoIncomeBudgetLastTargets'],
  );
  if (!row?.value) {
    return {};
  }
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLastTargets(targets: Targets): Promise<void> {
  const serialized: SerializedTargets = {};
  for (const [category, byMonth] of targets.entries()) {
    serialized[category] = Object.keys(byMonth);
  }
  await db.update('preferences', {
    id: 'autoIncomeBudgetLastTargets',
    value: JSON.stringify(serialized),
  });
}

type AutoBudgetSchedule = ScheduleEntity & {
  auto_budget_category: string;
  _account: string | null;
};

async function getAutoBudgetSchedules(): Promise<AutoBudgetSchedule[]> {
  const { data } = await aqlQuery(
    q('schedules')
      .filter({
        completed: false,
        tombstone: false,
        auto_budget_category: { $ne: null },
      })
      .select('*'),
  );
  return data as AutoBudgetSchedule[];
}

/**
 * Enumerate all occurrences of a schedule that fall in the inclusive range
 * [fromMonth, toMonth] (YYYY-MM strings) and return a sum (in cents) per
 * month.
 */
export function projectOccurrencesByMonth(
  schedule: Pick<ScheduleEntity, '_amount' | '_date' | 'next_date'> & {
    _conditions?: RuleConditionEntity[];
  },
  fromMonth: string,
  toMonth: string,
): MonthCents {
  const result: MonthCents = {};
  const amount = getScheduledAmount(schedule._amount);
  if (amount === 0) {
    return result;
  }

  const start = parseDate(fromMonth + '-01');
  const end = d.endOfMonth(parseDate(toMonth + '-01'));

  const dateValue = schedule._date;

  if (dateValue == null) {
    return result;
  }

  // One-time schedule: _date is a string (YYYY-MM-DD) or its next_date is set.
  if (typeof dateValue === 'string') {
    const occurrenceDate = parseDate(dateValue);
    if (occurrenceDate >= start && occurrenceDate <= end) {
      const month = monthFromDate(occurrenceDate);
      result[month] = (result[month] || 0) + amount;
    }
    return result;
  }

  // Recurring schedule: walk RSchedule occurrences in the window.
  try {
    const rules = recurConfigToRSchedule(dateValue);
    const rs = new RSchedule({ rrules: rules });
    const occurrences = rs.occurrences({ start, end }).toArray();
    for (const occ of occurrences) {
      let date = occ.date;
      if (dateValue.skipWeekend) {
        date = getDateWithSkippedWeekend(
          date,
          dateValue.weekendSolveMode || 'after',
        );
      }
      if (date < start || date > end) continue;
      const month = monthFromDate(date);
      result[month] = (result[month] || 0) + amount;
    }
  } catch {
    // If the recurrence config is malformed, just skip.
    return {};
  }

  return result;
}

function buildTargets(
  schedules: AutoBudgetSchedule[],
  fromMonth: string,
  toMonth: string,
): Targets {
  const targets: Targets = new Map();
  for (const schedule of schedules) {
    if (!schedule.auto_budget_category) continue;
    const byMonth = projectOccurrencesByMonth(schedule, fromMonth, toMonth);
    if (Object.keys(byMonth).length === 0) continue;
    const existing = targets.get(schedule.auto_budget_category) || {};
    for (const [month, cents] of Object.entries(byMonth)) {
      existing[month] = (existing[month] || 0) + cents;
    }
    targets.set(schedule.auto_budget_category, existing);
  }
  return targets;
}

/**
 * Recompute auto-budgeted income amounts. Called from the schedule service,
 * on schedule create/update/delete, and on demand via the
 * `schedule/recompute-auto-income` handler.
 */
export async function recomputeAutoIncomeBudgets(): Promise<void> {
  // Only applies to the tracking budget — envelope budgeting doesn't
  // have a per-month income budget concept.
  if (!isTrackingBudget()) {
    return;
  }

  if (!prefs.getPrefs() || !db.getDatabase()) {
    return;
  }

  const horizon = readHorizon();
  const fromMonth = currentMonth();
  const toMonth = addMonths(fromMonth, horizon - 1);

  const schedules = await getAutoBudgetSchedules();
  const targets = buildTargets(schedules, fromMonth, toMonth);
  const previous = readLastTargets();

  await batchMessages(async () => {
    // Write new auto-managed amounts.
    for (const [category, byMonth] of targets.entries()) {
      for (const month of Object.keys(byMonth)) {
        const amount = byMonth[month];
        await setBudget({ category, month, amount });
      }
    }

    // Clear stale months: anything we managed last run but no longer do,
    // and only for months >= fromMonth (never touch the past).
    for (const [category, prevMonths] of Object.entries(previous)) {
      const stillManaged = targets.get(category) || {};
      for (const month of prevMonths) {
        if (month < fromMonth) continue;
        if (stillManaged[month] !== undefined) continue;
        await setBudget({ category, month, amount: 0 });
      }
    }
  });

  await writeLastTargets(targets);
}

/**
 * Returns the set of category IDs that are auto-managed by at least one
 * active schedule. Used by the client to render budget cells as read-only.
 */
export async function getAutoManagedIncomeCategoryIds(): Promise<string[]> {
  const schedules = await getAutoBudgetSchedules();
  const ids = new Set<string>();
  for (const schedule of schedules) {
    if (schedule.auto_budget_category) {
      ids.add(schedule.auto_budget_category);
    }
  }
  return Array.from(ids);
}
