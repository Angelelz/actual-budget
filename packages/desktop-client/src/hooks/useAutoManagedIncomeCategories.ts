import { useEffect, useMemo, useState } from 'react';

import { q } from '@actual-app/core/shared/query';

import { liveQuery } from '#queries/liveQuery';

type ScheduleRow = { id: string; auto_budget_category: string | null };

/**
 * Returns the set of category IDs that are managed by an active schedule's
 * auto_budget_category. The set updates live as schedules change.
 */
export function useAutoManagedIncomeCategories(): Set<string> {
  const [rows, setRows] = useState<ScheduleRow[]>([]);

  useEffect(() => {
    const live = liveQuery<ScheduleRow>(
      q('schedules')
        .filter({
          completed: false,
          tombstone: false,
          auto_budget_category: { $ne: null },
        })
        .select(['id', 'auto_budget_category']),
      {
        onData: data => setRows(data),
      },
    );
    return live.unsubscribe;
  }, []);

  return useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.auto_budget_category) {
        ids.add(row.auto_budget_category);
      }
    }
    return ids;
  }, [rows]);
}
